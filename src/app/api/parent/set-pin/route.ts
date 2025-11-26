
import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { headers } from 'next/headers';
import { auth } from 'firebase-admin';
import { createHmac } from 'crypto';

// Initialize Firebase Admin SDK
initFirebaseAdminApp();

async function getUserIdFromToken() {
  const authorization = headers().get('Authorization');
  if (authorization?.startsWith('Bearer ')) {
    const idToken = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(idToken);
    return decodedToken.uid;
  }
  return null;
}

function hashPin(pin: string): string {
    const salt = process.env.PIN_SALT || 'default-super-secret-salt';
    return createHmac('sha256', salt).update(pin).digest('hex');
}


export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromToken();
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { pin } = await request.json();
    if (typeof pin !== 'string' || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return NextResponse.json({ ok: false, message: 'Invalid PIN format. Must be 4 digits.' }, { status: 400 });
    }

    const firestore = getFirestore();
    const userRef = firestore.collection('users').doc(userId);

    const pinHash = hashPin(pin);

    await userRef.update({ pinHash });

    return NextResponse.json({ ok: true, message: 'PIN set successfully' });

  } catch (error: any) {
    console.error('Error in /api/parent/set-pin:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        return NextResponse.json({ ok: false, message: 'Authentication token is invalid.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: 'An unexpected error occurred.' }, { status: 500 });
  }
}

    