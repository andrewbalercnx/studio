import { headers } from 'next/headers';
import { auth } from 'firebase-admin';
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

export async function requireParentOrAdminUser(request: Request): Promise<VerifiedUser> {
  'use server';
  const verified = await requireAuthenticatedUser(request);
  const claims = verified.claims ?? {};
  const isPrivileged = claims.isAdmin || claims.isWriter;
  if (claims.isParent || isPrivileged) {
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
