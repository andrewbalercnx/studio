import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrderAddress } from '@/lib/types';

/**
 * GET /api/user/shipping-address
 * Returns the user's saved shipping address
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const userDoc = await firestore.collection('users').doc(user.uid).get();
    const userData = userDoc.data();

    const savedAddress: PrintOrderAddress | null = userData?.savedShippingAddress || null;

    return NextResponse.json({
      ok: true,
      address: savedAddress,
    });
  } catch (error: any) {
    console.error('[user/shipping-address] Error fetching address:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
