
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
     if (!salt) {
        throw new Error('PIN_SALT environment variable is not set.');
    }
    return createHmac('sha256', salt).update(pin).digest('hex');
}

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromToken();
    if (!userId) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { pin } = await request.json();
    if (typeof pin !== 'string' || pin.length !== 4) {
      return NextResponse.json({ ok: false, message: 'Invalid PIN format.' }, { status: 400 });
    }
    
    const firestore = getFirestore();
    const userDoc = await firestore.collection('users').doc(userId).get();

    if (!userDoc.exists) {
        return NextResponse.json({ ok: false, message: 'User profile not found.' }, { status: 404 });
    }
    
    const userData = userDoc.data();
    const storedHash = userData?.pinHash;

    if (!storedHash) {
        return NextResponse.json({ ok: false, message: 'No PIN has been set for this account.' }, { status: 400 });
    }
    
    const enteredPinHash = hashPin(pin);

    if (enteredPinHash === storedHash) {
        return NextResponse.json({ ok: true, message: 'PIN verified.' });
    } else {
        return NextResponse.json({ ok: false, message: 'Incorrect PIN.' }, { status: 403 });
    }

  } catch (error: any) {
    console.error('Error in /api/parent/verify-pin:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
        return NextResponse.json({ ok: false, message: 'Authentication token is invalid.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: 'An unexpected error occurred.' }, { status: 500 });
  }
}
