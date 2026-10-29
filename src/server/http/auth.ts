/**
 * Credential verification for `withRoute`.
 *
 * - Users: a Firebase ID token in the `Authorization: Bearer` header. There is
 *   deliberately no `?idToken=` query fallback (tokens in URLs end up in logs).
 * - Internal callers: a Google-signed OIDC token minted by Cloud Tasks for the
 *   app's invoker service account. Audience and expected email come from env,
 *   and a missing setting denies (fail closed).
 */
import type { DecodedIdToken } from 'firebase-admin/auth';
import { UnauthenticatedError } from '../errors';

export type VerifiedUser = {
  uid: string;
  email: string | null;
  claims: DecodedIdToken;
};

export type InternalCaller = {
  /** Service-account email the OIDC token was minted for. */
  email: string;
};

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function verifyUserToken(request: Request): Promise<VerifiedUser> {
  const token = readBearerToken(request);
  if (!token) {
    throw new UnauthenticatedError('Missing ID token');
  }
  const { initFirebaseAdminApp } = await import('@/firebase/admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  await initFirebaseAdminApp();
  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch (error) {
    console.warn('[server/http/auth] ID token verification failed', (error as Error)?.message ?? error);
    throw new UnauthenticatedError('Invalid or expired ID token');
  }
  if (!decoded?.uid) {
    throw new UnauthenticatedError('Token missing uid');
  }
  return { uid: decoded.uid, email: decoded.email ?? null, claims: decoded };
}

export type InternalAuthConfig = {
  audience: string;
  serviceAccountEmail: string;
};

/**
 * Reads the internal-auth settings shared with the Cloud Tasks dispatcher:
 * `JOBS_OIDC_AUDIENCE` (defaults to `JOBS_RUN_URL`) and
 * `JOBS_INVOKER_SERVICE_ACCOUNT`.
 */
export function readInternalAuthConfig(env: Record<string, string | undefined> = process.env): InternalAuthConfig | null {
  const audience = env.JOBS_OIDC_AUDIENCE || env.JOBS_RUN_URL;
  const serviceAccountEmail = env.JOBS_INVOKER_SERVICE_ACCOUNT;
  if (!audience || !serviceAccountEmail) return null;
  return { audience, serviceAccountEmail };
}

type OidcPayload = { email?: string; email_verified?: boolean } | undefined;
export type OidcVerifier = (idToken: string, audience: string) => Promise<OidcPayload>;

let oauthClient: import('google-auth-library').OAuth2Client | null = null;

const defaultOidcVerifier: OidcVerifier = async (idToken, audience) => {
  if (!oauthClient) {
    const { OAuth2Client } = await import('google-auth-library');
    oauthClient = new OAuth2Client();
  }
  const ticket = await oauthClient.verifyIdToken({ idToken, audience });
  return ticket.getPayload();
};

export async function verifyInternalCaller(
  request: Request,
  options: { config?: InternalAuthConfig | null; verify?: OidcVerifier } = {}
): Promise<InternalCaller> {
  const config = options.config === undefined ? readInternalAuthConfig() : options.config;
  if (!config) {
    console.error('[server/http/auth] Internal auth is not configured (JOBS_OIDC_AUDIENCE/JOBS_RUN_URL, JOBS_INVOKER_SERVICE_ACCOUNT)');
    throw new UnauthenticatedError('Internal authentication is not configured');
  }
  const token = readBearerToken(request);
  if (!token) {
    throw new UnauthenticatedError('Missing OIDC token');
  }
  let payload: OidcPayload;
  try {
    payload = await (options.verify ?? defaultOidcVerifier)(token, config.audience);
  } catch (error) {
    console.warn('[server/http/auth] OIDC verification failed', (error as Error)?.message ?? error);
    throw new UnauthenticatedError('Invalid OIDC token');
  }
  if (!payload?.email || payload.email_verified !== true || payload.email !== config.serviceAccountEmail) {
    throw new UnauthenticatedError('OIDC token is not from the job invoker');
  }
  return { email: payload.email };
}

export function isAdmin(user: VerifiedUser): boolean {
  return user.claims.isAdmin === true;
}

/** Admin and writer principals operate across families (admin tooling, regression tests). */
export function isPrivileged(user: VerifiedUser): boolean {
  return user.claims.isAdmin === true || user.claims.isWriter === true;
}
