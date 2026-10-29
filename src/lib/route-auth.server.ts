import { NextResponse } from 'next/server';
import { getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { AuthError } from './auth-error';
import { requireAuthenticatedUser, type VerifiedUser } from './server-auth';
import { enforcePersonaScope } from './persona.server';

/**
 * Ownership guards for API routes.
 *
 * Every route here runs on the Admin SDK, which bypasses firestore.rules, so
 * the route itself must prove the caller owns what it touches. Each guard:
 *   1. requires a valid Firebase ID token (any signed-in user; parent roles
 *      live in Firestore, not token claims — see server-auth.ts),
 *   2. loads the target document and compares its owner field to the token
 *      uid. A missing owner field is treated as "not yours", never as "open",
 *   3. lets admin/writer principals through (admin test and regression tools
 *      operate across families),
 *   4. applies the child-persona scope check with the *token* uid.
 *
 * Failures are thrown as RouteAuthError; convert with routeAuthErrorResponse.
 */

export type OwnedDoc = {
  user: VerifiedUser;
  ref: DocumentReference;
  data: Record<string, any>;
};

export class RouteAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type OwnedCollection = {
  collection: string;
  ownerField: string;
  label: string;
};

const STORY: OwnedCollection = { collection: 'stories', ownerField: 'parentUid', label: 'Story' };
const CHILD: OwnedCollection = { collection: 'children', ownerField: 'ownerParentUid', label: 'Child' };
const CHARACTER: OwnedCollection = { collection: 'characters', ownerField: 'ownerParentUid', label: 'Character' };
const PRINT_STORYBOOK: OwnedCollection = { collection: 'printStoryBooks', ownerField: 'ownerUserId', label: 'Print storybook' };

export function isPrivileged(user: VerifiedUser): boolean {
  return user.claims.isAdmin === true || user.claims.isWriter === true;
}

export async function requireUser(request: Request): Promise<VerifiedUser> {
  try {
    return await requireAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof AuthError) {
      throw new RouteAuthError(error.status, error.code, error.message);
    }
    throw error;
  }
}

/** Check that an already-verified user owns `data`, without re-reading it. */
export async function assertOwns(
  user: VerifiedUser,
  data: Record<string, any>,
  ownerField: string,
  label: string
): Promise<void> {
  if (!isPrivileged(user) && data[ownerField] !== user.uid) {
    throw new RouteAuthError(403, 'FORBIDDEN', `You do not have access to this ${label.toLowerCase()}.`);
  }
  const persona = await enforcePersonaScope({
    expectedUid: user.uid,
    effectiveChildId: typeof data.childId === 'string' ? data.childId : null,
    claims: user.claims,
  });
  if (!persona.ok) {
    throw new RouteAuthError(persona.status, persona.code, persona.message);
  }
}

/** Help-tour sample docs (`help-*`), readable by any signed-in user, as in firestore.rules. */
export function isHelpDocumentId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('help-');
}

async function loadOwned(
  user: VerifiedUser,
  spec: OwnedCollection,
  id: unknown,
  options: { allowHelpDocuments?: boolean } = {}
): Promise<OwnedDoc> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new RouteAuthError(400, 'BAD_REQUEST', `Missing ${spec.label.toLowerCase()} id`);
  }
  await initFirebaseAdminApp();
  const ref = getFirestore().collection(spec.collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new RouteAuthError(404, 'NOT_FOUND', `${spec.label} not found`);
  }
  const data = snap.data() as Record<string, any>;
  if (!(options.allowHelpDocuments && isHelpDocumentId(id))) {
    await assertOwns(user, data, spec.ownerField, spec.label);
  }
  return { user, ref, data };
}

async function guard(request: Request, spec: OwnedCollection, id: unknown): Promise<OwnedDoc> {
  const user = await requireUser(request);
  return loadOwned(user, spec, id);
}

/** Read-only variant: also lets any signed-in user read help-tour sample stories. */
export const requireStoryReader = async (request: Request, storyId: unknown) =>
  loadOwned(await requireUser(request), STORY, storyId, { allowHelpDocuments: true });
export const requireChildOwner = (request: Request, childId: unknown) => guard(request, CHILD, childId);
export const requireCharacterOwner = (request: Request, characterId: unknown) => guard(request, CHARACTER, characterId);
export const requirePrintStoryBookOwner = (request: Request, printStoryBookId: unknown) =>
  guard(request, PRINT_STORYBOOK, printStoryBookId);

/** For a second resource checked after the first guard has verified the user. */
export const assertStoryOwner = (user: VerifiedUser, storyId: unknown) => loadOwned(user, STORY, storyId);
export const assertCharacterOwner = (user: VerifiedUser, characterId: unknown) => loadOwned(user, CHARACTER, characterId);
export const assertChildOwner = (user: VerifiedUser, childId: unknown) => loadOwned(user, CHILD, childId);

/**
 * Returns a JSON error response for a RouteAuthError, or null for any other
 * error so the route's own handling runs. `extra` lets routes keep their
 * existing response envelope (e.g. `{ ok: false }`).
 */
export function routeAuthErrorResponse(
  error: unknown,
  extra: Record<string, unknown> = {}
): NextResponse | null {
  if (!(error instanceof RouteAuthError)) return null;
  return NextResponse.json(
    { ...extra, ok: false, error: error.message, errorMessage: error.message, code: error.code },
    { status: error.status }
  );
}
