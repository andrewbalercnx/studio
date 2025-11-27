
import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { headers } from 'next/headers';
import { auth } from 'firebase-admin';
import { randomBytes, scryptSync } from 'crypto';

// Initialize Firebase Admin SDK
initFirebaseAdminApp();

type UnauthorizedReason =
  | 'MISSING_TOKEN'
  | 'TOKEN_DECODE_FAILED';

type TokenDiagnostics = {
  hasHeaderToken: boolean;
  hasQueryToken: boolean;
  hasBodyToken: boolean;
};

function respondUnauthorized(reason: UnauthorizedReason, diag: TokenDiagnostics) {
  console.warn('[set-pin] Unauthorized:', reason, diag);
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
    console.warn('[set-pin] Token decode failed', error);
    return { uid: null, error: 'TOKEN_DECODE_FAILED' as UnauthorizedReason };
  }
}

const SALT_BYTE_LENGTH = 16;
const KEY_LENGTH = 64;

function derivePinHash(pin: string, salt: string): string {
  return scryptSync(pin, salt, KEY_LENGTH).toString('hex');
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
      return NextResponse.json({ ok: false, message: 'Invalid PIN format. Must be 4 digits.' }, { status: 400 });
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
    let userId: string | null = null;
    for (const source of tokenSources) {
      const result = await resolveUserId(source.token ?? null);
      if (result.uid) {
        userId = result.uid;
        break;
      }
      if (result.error && result.error !== 'MISSING_TOKEN') {
        lastError = result.error;
      } else if (!lastError) {
        lastError = result.error ?? null;
      }
    }
    if (!userId) {
      return respondUnauthorized(lastError ?? 'MISSING_TOKEN', diag);
    }

    const firestore = getFirestore();
    const userRef = firestore.collection('users').doc(userId);

    const salt = randomBytes(SALT_BYTE_LENGTH).toString('hex');
    const pinHash = derivePinHash(pin, salt);

    // Using `set` with `merge: true` is safer as it won't overwrite the whole doc
    await userRef.set({
      pinHash,
      pinSalt: salt,
      pinUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ ok: true, message: 'PIN set successfully' });

  } catch (error: any) {
    console.error('Error in /api/parent/set-pin:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        return NextResponse.json({ ok: false, message: 'Authentication token is invalid.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: 'An unexpected error occurred.' }, { status: 500 });
  }
}
