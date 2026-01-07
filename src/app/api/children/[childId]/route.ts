import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * GET /api/children/[childId]
 * Returns a specific child belonging to the authenticated parent.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ childId: string }> }
) {
  try {
    const { childId } = await params;

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Fetch the child
    const childDoc = await firestore.collection('children').doc(childId).get();

    if (!childDoc.exists) {
      return NextResponse.json({ error: 'Child not found' }, { status: 404 });
    }

    const childData = childDoc.data();

    // Verify ownership
    if (childData?.ownerParentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      id: childDoc.id,
      ...childData,
    });
  } catch (error: any) {
    console.error('[GET /api/children/[childId]] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch child' },
      { status: 500 }
    );
  }
}
