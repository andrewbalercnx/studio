import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { headers } from 'next/headers';
import { auth } from 'firebase-admin';
import { scryptSync, timingSafeEqual } from 'crypto';

initFirebaseAdminApp();

const KEY_LENGTH = 64;

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

function extractBearerToken(): string | null {
  const headerList = headers();
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
    const decodedToken = await auth().verifyIdToken(token);
    return { uid: decodedToken.uid, error: null };
  } catch (error) {
    console.warn('[verify-pin] Token decode failed', error);
    return { uid: null, error: 'TOKEN_DECODE_FAILED' as UnauthorizedReason, rawError: (error as Error)?.message };
  }
}

function derivePinHash(pin: string, salt: string) {
  return scryptSync(pin, salt, KEY_LENGTH);
}

export async function POST(request: Request) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { pin, idToken: bodyToken } = body;
    if (typeof pin !== 'string' || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ ok: false, code: 'INVALID_PIN_FORMAT', message: 'Invalid PIN format. Must be 4 digits.' }, { status: 400 });
    }

    const headerToken = extractBearerToken();
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
    const pinHash: string | undefined = userData.pinHash;
    const pinSalt: string | undefined = userData.pinSalt;

    if (!pinHash || !pinSalt) {
      return NextResponse.json({ ok: false, code: 'PIN_NOT_SET', message: 'No PIN configured for this account.' }, { status: 400 });
    }

    const computedHash = derivePinHash(pin, pinSalt);
    const storedHashBuffer = Buffer.from(pinHash, 'hex');

    if (storedHashBuffer.length !== computedHash.length) {
      return NextResponse.json({ ok: false, code: 'PIN_MISMATCH', message: 'PIN verification failed.' }, { status: 401 });
    }

    const isMatch = timingSafeEqual(computedHash, storedHashBuffer);
    if (!isMatch) {
      return NextResponse.json({ ok: false, code: 'INCORRECT_PIN', message: 'Incorrect PIN. Please try again.' }, { status: 401 });
    }

    return NextResponse.json({ ok: true, message: 'PIN verified.' });
  } catch (error: any) {
    console.error('Error in /api/parent/verify-pin:', error);
    const responsePayload = {
      ok: false,
      message: error?.message || 'An unexpected error occurred.',
      code: error?.code || 'UNKNOWN',
      stack: error?.stack,
    };
    const status = error?.code === 'auth/id-token-expired' || error?.code === 'auth/argument-error' ? 401 : 500;
    return NextResponse.json(responsePayload, { status });
  }
}
