import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * GET /api/children
 * Returns the authenticated parent's children, excluding soft-deleted ones.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Fetch children for this parent
    const childrenSnapshot = await firestore
      .collection('children')
      .where('ownerParentUid', '==', authResult.uid)
      .get();

    // Soft-deleted children are hidden, as Firestore rules hide them from
    // direct reads.
    const children = childrenSnapshot.docs
      .filter(doc => !doc.data().deletedAt)
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

    return NextResponse.json(children);
  } catch (error: any) {
    console.error('[GET /api/children] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch children' },
      { status: 500 }
    );
  }
}
