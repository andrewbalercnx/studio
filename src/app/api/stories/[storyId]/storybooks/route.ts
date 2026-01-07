import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * GET /api/stories/[storyId]/storybooks
 * Returns storybooks for a specific story.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ storyId: string }> }
) {
  try {
    const { storyId } = await params;

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Verify ownership of the story
    const storyDoc = await firestore.collection('stories').doc(storyId).get();
    if (!storyDoc.exists || storyDoc.data()?.parentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch storybooks from subcollection
    const storybooksSnapshot = await firestore
      .collection('stories')
      .doc(storyId)
      .collection('storybooks')
      .get();

    const rawStorybooks = storybooksSnapshot.docs
      .filter(doc => !doc.data().deletedAt)
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          storyId,
          ...data,
        };
      })
      // Sort by createdAt descending (most recent first) - done in JS to avoid composite index
      .sort((a, b) => {
        const aTime = (a as any).createdAt?.seconds || (a as any).createdAt?._seconds || 0;
        const bTime = (b as any).createdAt?.seconds || (b as any).createdAt?._seconds || 0;
        return bTime - aTime;
      });

    // Fetch first page imageUrl for each storybook as thumbnail
    const storybooks = await Promise.all(
      rawStorybooks.map(async (sb: any) => {
        // If thumbnailUrl already exists, use it
        if (sb.thumbnailUrl) {
          return sb;
        }
        // Otherwise, fetch the first page to get its imageUrl
        try {
          const firstPageSnapshot = await firestore
            .collection('stories')
            .doc(storyId)
            .collection('storybooks')
            .doc(sb.id)
            .collection('pages')
            .orderBy('pageNumber')
            .limit(1)
            .get();

          if (!firstPageSnapshot.empty) {
            const firstPage = firstPageSnapshot.docs[0].data();
            return {
              ...sb,
              thumbnailUrl: firstPage.imageUrl || null,
            };
          }
        } catch (e) {
          console.error(`Error fetching first page for storybook ${sb.id}:`, e);
        }
        return sb;
      })
    );

    return NextResponse.json(storybooks);
  } catch (error: any) {
    console.error('[GET /api/stories/[storyId]/storybooks] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch storybooks' },
      { status: 500 }
    );
  }
}
