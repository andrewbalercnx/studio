import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * GET /api/storyOutputTypes
 * Returns available story output types (book formats) for children to choose from.
 *
 * Only returns output types with status === 'live'.
 * Sorted by name alphabetically.
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

    // Fetch all live output types
    const outputTypesSnapshot = await firestore
      .collection('storyOutputTypes')
      .where('status', '==', 'live')
      .get();

    const outputTypes = outputTypesSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      }))
      // Sort alphabetically by name
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

    return NextResponse.json({ ok: true, outputTypes });
  } catch (error: any) {
    console.error('[GET /api/storyOutputTypes] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Failed to fetch output types' },
      { status: 500 }
    );
  }
}
