import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { headers } from 'next/headers';
import { auth } from 'firebase-admin';
import { scryptSync, timingSafeEqual } from 'crypto';
import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  applyFailedAttempt,
  lockoutRemainingMs,
} from '@/lib/pin-lockout';

const KEY_LENGTH = 64;

function lockedResponse(remainingMs: number) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return NextResponse.json(
    {
      ok: false,
      code: 'PIN_LOCKED',
      message: `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      retryAfterMs: remainingMs,
    },
    { status: 429 },
  );
}

/**
 * Atomically record a failed attempt; returns the lock duration when this
 * failure tripped (or found) a lock, else null. Transactional so concurrent
 * guesses cannot bypass the counter. Decisions live in src/lib/pin-lockout.ts
 * (pure, unit-tested); this is just the Firestore plumbing.
 */
async function recordFailedAttempt(userRef: DocumentReference): Promise<number | null> {
  const firestore = getFirestore();
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const transition = applyFailedAttempt(snap.data(), Date.now());
    if (transition.update) {
      tx.update(userRef, {
        pinFailedAttempts: transition.update.pinFailedAttempts,
        ...(transition.update.pinLockedUntilMs !== undefined
          ? { pinLockedUntil: Timestamp.fromMillis(transition.update.pinLockedUntilMs) }
          : {}),
      });
    }
    return transition.lockedForMs;
  });
}

type UnauthorizedReason =
  | 'MISSING_TOKEN'
  | 'TOKEN_DECODE_FAILED'
  | 'PROFILE_NOT_FOUND';

type TokenDiagnostics = {
  hasHeaderToken: boolean;
  hasQueryToken: boolean;
  hasBodyToken: boolean;
  lastErrorMessage?: string | null;
};

function respondUnauthorized(reason: UnauthorizedReason, diag?: TokenDiagnostics) {
  console.warn('[verify-pin] Unauthorized:', reason, diag);
  return NextResponse.json({ ok: false, message: 'Unauthorized', code: reason, details: diag }, { status: 401 });
}

async function extractBearerToken(): Promise<string | null> {
  const headerList = await headers();
  const authorization = headerList.get('Authorization') ?? headerList.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.split('Bearer ')[1];
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

async function resolveUserId(token?: string | null) {
  if (!token) return { uid: null, error: 'MISSING_TOKEN' as UnauthorizedReason };
  try {
    console.log('[verify-pin] Attempting to verify token, length:', token.length, 'prefix:', token.substring(0, 20) + '...');
    const decodedToken = await auth().verifyIdToken(token);
    console.log('[verify-pin] Token verified successfully, uid:', decodedToken.uid);
    return { uid: decodedToken.uid, error: null };
  } catch (error: any) {
    console.error('[verify-pin] Token decode failed:', {
      code: error?.code,
      message: error?.message,
      name: error?.name,
      stack: error?.stack?.substring(0, 500),
    });
    return { uid: null, error: 'TOKEN_DECODE_FAILED' as UnauthorizedReason, rawError: error?.message };
  }
}

function derivePinHash(pin: string, salt: string) {
  return scryptSync(pin, salt, KEY_LENGTH);
}

export async function POST(request: Request) {
  console.log('[verify-pin] POST handler started');
  const adminApp = await initFirebaseAdminApp();
  console.log('[verify-pin] Firebase Admin initialized, app name:', adminApp?.name);
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { pin, idToken: bodyToken } = body;
    // dryRun: validation-only introspection path for the regression suite —
    // reports the lockout configuration and current state WITHOUT comparing a
    // PIN or recording an attempt (non-destructive by design).
    const isDryRun = body?.dryRun === true;
    if (!isDryRun && (typeof pin !== 'string' || pin.length !== 4 || !/^\d{4}$/.test(pin))) {
      return NextResponse.json({ ok: false, code: 'INVALID_PIN_FORMAT', message: 'Invalid PIN format. Must be 4 digits.' }, { status: 400 });
    }

    const headerToken = await extractBearerToken();
    const queryToken = extractQueryToken(request);
    const diag: TokenDiagnostics = {
      hasHeaderToken: !!headerToken,
      hasQueryToken: !!queryToken,
      hasBodyToken: !!bodyToken,
    };
    const tokenSources: Array<{ token: string | null | undefined }> = [
      { token: headerToken },
      { token: queryToken },
      { token: bodyToken },
    ];
    let lastError: UnauthorizedReason | null = null;
    let lastErrorMessage: string | null = null;
    let userId: string | null = null;
    for (const source of tokenSources) {
      const result = await resolveUserId(source.token ?? null);
      if (result.uid) {
        userId = result.uid;
        break;
      }
      if (result.error && result.error !== 'MISSING_TOKEN') {
        lastError = result.error;
        lastErrorMessage = (result as any).rawError ?? null;
      } else if (!lastError) {
        lastError = result.error ?? null;
      }
    }
    diag.lastErrorMessage = lastErrorMessage;
    if (!userId) {
      return respondUnauthorized(lastError ?? 'MISSING_TOKEN', diag);
    }

    const firestore = getFirestore();
    const userRef = firestore.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return respondUnauthorized('PROFILE_NOT_FOUND', diag);
    }

    const userData = userSnap.data() || {};

    if (isDryRun) {
      const remainingDry = lockoutRemainingMs(userData, Date.now());
      return NextResponse.json({
        ok: true,
        dryRun: true,
        lockout: { maxAttempts: MAX_FAILED_ATTEMPTS, lockoutMs: LOCKOUT_MS },
        locked: remainingDry > 0,
        retryAfterMs: remainingDry > 0 ? remainingDry : undefined,
        failedAttempts: typeof userData.pinFailedAttempts === 'number' ? userData.pinFailedAttempts : 0,
      });
    }

    // Lockout gate BEFORE any comparison: a locked account reveals nothing
    // about whether the supplied PIN was right.
    const remainingLockMs = lockoutRemainingMs(userData, Date.now());
    if (remainingLockMs > 0) {
      return lockedResponse(remainingLockMs);
    }

    const pinHash: string | undefined = userData.pinHash;
    const pinSalt: string | undefined = userData.pinSalt;

    if (!pinHash || !pinSalt) {
      return NextResponse.json({ ok: false, code: 'PIN_NOT_SET', message: 'No PIN configured for this account.' }, { status: 400 });
    }

    const computedHash = derivePinHash(pin, pinSalt);
    const storedHashBuffer = Buffer.from(pinHash, 'hex');

    // Length mismatch (corrupt stored hash) and a wrong PIN take the same
    // failure path: both count toward the lockout and return the same
    // user-facing code, so neither leaks which case occurred. The comparison
    // itself is timing-safe (scrypt output is fixed-length; see also
    // src/lib/internal-secret.ts for the shared-secret variant).
    const isMatch =
      storedHashBuffer.length === computedHash.length &&
      timingSafeEqual(computedHash, storedHashBuffer);
    if (!isMatch) {
      const lockedForMs = await recordFailedAttempt(userRef);
      if (lockedForMs !== null) {
        return lockedResponse(lockedForMs);
      }
      return NextResponse.json({ ok: false, code: 'INCORRECT_PIN', message: 'Incorrect PIN. Please try again.' }, { status: 401 });
    }

    // Success: reset the failure counter / any expired lock marker.
    if (userData.pinFailedAttempts || userData.pinLockedUntil) {
      await userRef.update({
        pinFailedAttempts: 0,
        pinLockedUntil: FieldValue.delete(),
      });
    }

    return NextResponse.json({ ok: true, message: 'PIN verified.' });
  } catch (error: any) {
    console.error('Error in /api/parent/verify-pin [v2]:', error);
    const responsePayload = {
      ok: false,
      message: error?.message || 'An unexpected error occurred.',
      code: error?.code || 'UNKNOWN',
      stack: error?.stack,
      version: 'v2',
    };
    const status = error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error' ? 401 : 500;
    return NextResponse.json(responsePayload, { status });
  }
}
