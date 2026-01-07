import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * GET /api/stories?childId=xxx
 * Returns stories for a specific child belonging to the authenticated parent.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get('childId');

    if (!childId) {
      return NextResponse.json({ error: 'childId is required' }, { status: 400 });
    }

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Verify the child belongs to this parent
    const childDoc = await firestore.collection('children').doc(childId).get();
    if (!childDoc.exists || childDoc.data()?.ownerParentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch stories for this child
    const storiesSnapshot = await firestore
      .collection('stories')
      .where('childId', '==', childId)
      .get();

    const stories = storiesSnapshot.docs
      .filter(doc => !doc.data().deletedAt) // Exclude soft-deleted
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

    return NextResponse.json(stories);
  } catch (error: any) {
    console.error('[GET /api/stories] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stories' },
      { status: 500 }
    );
  }
}
