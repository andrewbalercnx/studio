import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * GET /api/imageStyles
 * Returns available image styles for storybook illustrations.
 *
 * Sorted with preferred styles first, then alphabetically by title.
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

    // Fetch all image styles
    const imageStylesSnapshot = await firestore
      .collection('imageStyles')
      .get();

    const imageStyles = imageStylesSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      }))
      // Sort: preferred first, then alphabetically by title
      .sort((a: any, b: any) => {
        // Preferred items come first
        if (a.preferred && !b.preferred) return -1;
        if (!a.preferred && b.preferred) return 1;
        // Then sort alphabetically
        return (a.title || '').localeCompare(b.title || '');
      });

    return NextResponse.json({ ok: true, imageStyles });
  } catch (error: any) {
    console.error('[GET /api/imageStyles] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Failed to fetch image styles' },
      { status: 500 }
    );
  }
}
