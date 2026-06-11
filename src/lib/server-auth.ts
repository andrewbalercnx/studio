import { headers } from 'next/headers';
import { auth, firestore } from 'firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { AuthError } from './auth-error';

export type VerifiedUser = {
  uid: string;
  email: string | null | undefined;
  claims: DecodedIdToken;
};

async function extractBearerToken(): Promise<string | null> {
  const headerList = await headers();
  const authorization = headerList.get('Authorization') ?? headerList.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return null;
}

function extractQueryToken(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('idToken');
  } catch {
    return null;
  }
}

async function resolveIdToken(request: Request): Promise<string | null> {
  const headerToken = await extractBearerToken();
  if (headerToken) return headerToken;
  const queryToken = extractQueryToken(request);
  if (queryToken) return queryToken;
  return null;
}

export async function requireAuthenticatedUser(request: Request): Promise<VerifiedUser> {
  'use server';
  await initFirebaseAdminApp();
  const token = await resolveIdToken(request);
  if (!token) {
    throw new AuthError('UNAUTHENTICATED', 'Missing ID token');
  }
  try {
    const decoded = await auth().verifyIdToken(token);
    if (!decoded?.uid) {
      throw new AuthError('UNAUTHENTICATED', 'Token missing uid');
    }
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      claims: decoded,
    };
  } catch (error: any) {
    console.warn('[server-auth] Failed to verify token', error?.message ?? error);
    throw new AuthError('UNAUTHENTICATED', 'Invalid or expired ID token');
  }
}

// Signup never provisions custom claims (it writes roles to the users/{uid}
// doc only), so a genuine parent's ID token carries no isParent claim. Fall
// back to the profile doc for isParent ONLY — isAdmin/isWriter must stay
// token-claim-gated because firestore.rules let users write their own doc
// (including roles), so doc-sourced admin would be self-grantable.
const parentRoleCache = new Map<string, { isParent: boolean; expiresAt: number }>();
const PARENT_ROLE_CACHE_MS = 60_000;

async function profileHasParentRole(uid: string): Promise<boolean> {
  const cached = parentRoleCache.get(uid);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.isParent;
  }
  let isParent = false;
  try {
    const snap = await firestore().doc(`users/${uid}`).get();
    isParent = snap.exists && snap.get('roles.isParent') === true;
  } catch (error: any) {
    console.warn('[server-auth] Failed to read profile roles', error?.message ?? error);
    return false; // fail closed; do not cache transient failures
  }
  parentRoleCache.set(uid, { isParent, expiresAt: now + PARENT_ROLE_CACHE_MS });
  return isParent;
}

export function hasParentAccess(claims: Record<string, unknown>): boolean {
  return claims.isParent === true || claims.isAdmin === true || claims.isWriter === true;
}

export async function requireParentOrAdminUser(request: Request): Promise<VerifiedUser> {
  'use server';
  const verified = await requireAuthenticatedUser(request);
  const claims = verified.claims ?? {};
  if (hasParentAccess(claims)) {
    return verified;
  }
  if (await profileHasParentRole(verified.uid)) {
    return verified;
  }
  throw new AuthError('FORBIDDEN', 'Parent access required');
}

export async function requireAdminUser(request: Request): Promise<VerifiedUser> {
  'use server';
  const verified = await requireAuthenticatedUser(request);
  const claims = verified.claims ?? {};
  if (claims.isAdmin) {
    return verified;
  }
  throw new AuthError('FORBIDDEN', 'Admin access required');
}
