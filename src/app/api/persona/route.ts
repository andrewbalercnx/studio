import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { isPlaceholderChild } from '@/lib/placeholder-child';
import {
  PERSONA_COOKIE_NAME,
  PERSONA_MAX_AGE_SECONDS,
  signPersonaCookie,
} from '@/lib/persona';
import { getPersonaSecret } from '@/lib/persona.server';

/**
 * POST /api/persona — set (or clear) the device's active child persona.
 *
 * Auth: any authenticated family account (bearer token). Body: { childId }.
 * With a string childId the child doc must exist, not be soft-deleted or a
 * legacy placeholder, and be owned by the caller; a signed httpOnly cookie is
 * then set binding {uid, childId}. With childId: null the cookie is cleared
 * (parent / unscoped persona). DELETE also clears.
 *
 * Called fire-and-forget by the web clients whenever a child persona is
 * entered, switched, or exited. Mobile clients never call this — see
 * src/lib/persona.ts for the fail-open rule that keeps them working.
 */

// Cookie security: httpOnly always; secure except under the E2E/TEST_MODE
// server (which serves plain http on 127.0.0.1 with NODE_ENV=production).
function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.TEST_MODE !== '1',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function clearPersonaCookie(response: NextResponse): NextResponse {
  response.cookies.set(PERSONA_COOKIE_NAME, '', cookieOptions(0));
  return response;
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireAuthenticatedUser(request);

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const childId = body?.childId ?? null;

    if (childId === null) {
      // Explicit clear → parent / unscoped persona.
      return clearPersonaCookie(NextResponse.json({ ok: true, persona: null }));
    }

    if (typeof childId !== 'string' || childId.trim().length === 0) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_CHILD_ID', message: 'childId must be a non-empty string or null.' },
        { status: 400 },
      );
    }

    const secret = getPersonaSecret();
    if (!secret) {
      // No signing key configured (bare local dev): persona cookies are
      // unavailable and every chokepoint fail-opens. Not an error the client
      // can act on — report it distinctly so it is visible in diagnostics.
      return NextResponse.json(
        { ok: false, code: 'PERSONA_UNAVAILABLE', message: 'Persona signing is not configured on this server.' },
        { status: 503 },
      );
    }

    const firestore = getFirestore();
    const childSnap = await firestore.collection('children').doc(childId).get();
    if (!childSnap.exists) {
      return NextResponse.json(
        { ok: false, code: 'CHILD_NOT_FOUND', message: 'Child profile not found.' },
        { status: 404 },
      );
    }
    const childData = childSnap.data() || {};
    if (childData.ownerParentUid !== user.uid) {
      return NextResponse.json(
        { ok: false, code: 'NOT_OWNER', message: 'Child profile not found.' },
        { status: 403 },
      );
    }
    if (childData.deletedAt) {
      return NextResponse.json(
        { ok: false, code: 'CHILD_DELETED', message: 'This profile is no longer available.' },
        { status: 400 },
      );
    }
    if (isPlaceholderChild(childData)) {
      return NextResponse.json(
        { ok: false, code: 'CHILD_PLACEHOLDER', message: 'This profile cannot be used.' },
        { status: 400 },
      );
    }

    const value = signPersonaCookie({ uid: user.uid, childId, iat: Date.now() }, secret);
    const response = NextResponse.json({ ok: true, persona: { childId } });
    response.cookies.set(PERSONA_COOKIE_NAME, value, cookieOptions(PERSONA_MAX_AGE_SECONDS));
    return response;
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, code: error.code, message: 'Unauthorized' },
        { status: error.code === 'UNAUTHENTICATED' ? 401 : 403 },
      );
    }
    console.error('[persona] POST failed', error);
    return NextResponse.json(
      { ok: false, code: 'UNKNOWN', message: 'Failed to set persona.' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/persona — clear the persona cookie (parent / unscoped).
 * Deliberately unauthenticated: clearing happens on sign-out, when no bearer
 * token exists anymore, and removing one's own cookie grants nothing.
 */
export async function DELETE() {
  return clearPersonaCookie(NextResponse.json({ ok: true, persona: null }));
}
