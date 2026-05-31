import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * Response type for a storybook item in the list.
 * Optimized for fast loading - thumbnails loaded separately.
 */
export type StorybookListItem = {
  storybookId: string;
  storyId: string;
  childId: string;
  title?: string;
  thumbnailUrl?: string | null;
  imageStyleId: string;
  printLayoutId?: string | null;
  createdAt: string; // ISO string
  imageGenerationStatus?: string;
  pageGenerationStatus?: string;
  audioStatus?: 'none' | 'partial' | 'ready';
  isNewModel: boolean;
  // Print-related fields
  printablePdfUrl?: string | null;
  printableCoverPdfUrl?: string | null;
  printableInteriorPdfUrl?: string | null;
};

export type ChildWithStorybooks = {
  childId: string;
  displayName: string;
  avatarUrl?: string | null;
  storybooks: StorybookListItem[];
};

export type StorybooksResponse = {
  children: ChildWithStorybooks[];
  totalBooks: number;
};

/**
 * GET /api/parent/storybooks
 * Returns all storybooks for the authenticated parent, grouped by child.
 *
 * Optimized for fast loading:
 * - Returns document-level data only (no page queries)
 * - Thumbnails included if cached on document, otherwise null
 * - Use ?includeThumbnails=true to fetch thumbnails from pages (slower)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentUid = authResult.uid;
    const { searchParams } = new URL(request.url);
    const includeThumbnails = searchParams.get('includeThumbnails') === 'true';

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Step 1+2: Get children and stories in parallel — both queries are independent
    const [childrenSnapshot, storiesSnapshot] = await Promise.all([
      firestore.collection('children').where('ownerParentUid', '==', parentUid).get(),
      firestore.collection('stories').where('parentUid', '==', parentUid).get(),
    ]);

    const childrenMap = new Map<string, { displayName: string; avatarUrl?: string | null }>();
    for (const doc of childrenSnapshot.docs) {
      const data = doc.data();
      // Skip deleted children
      if (data.deletedAt) continue;
      childrenMap.set(doc.id, {
        displayName: data.displayName || 'Child',
        avatarUrl: data.avatarUrl || null,
      });
    }

    if (childrenMap.size === 0) {
      return NextResponse.json({
        children: [],
        totalBooks: 0,
      } satisfies StorybooksResponse);
    }

    // Group storybooks by child
    const storybooksByChild = new Map<string, StorybookListItem[]>();
    for (const childId of childrenMap.keys()) {
      storybooksByChild.set(childId, []);
    }

    // Filter to active stories belonging to known children before firing subcollection queries
    const activeStoryDocs = storiesSnapshot.docs.filter(doc => {
      const story = doc.data();
      return !story.deletedAt && childrenMap.has(story.childId);
    });

    // Process legacy storybooks (stored on story document itself) — no extra query needed
    for (const storyDoc of activeStoryDocs) {
      const story = storyDoc.data();
      const storyId = storyDoc.id;
      if (story.pageGeneration?.status === 'ready' || story.imageGeneration?.status === 'ready') {
        const item: StorybookListItem = {
          storybookId: storyId,
          storyId: storyId,
          childId: story.childId,
          title: story.metadata?.title,
          thumbnailUrl: null, // Legacy model - needs page query for thumbnail
          imageStyleId: story.selectedImageStyleId || '',
          printLayoutId: null,
          createdAt: story.updatedAt?.toDate?.()?.toISOString() ||
                     story.createdAt?.toDate?.()?.toISOString() ||
                     new Date().toISOString(),
          imageGenerationStatus: story.imageGeneration?.status || 'pending',
          pageGenerationStatus: story.pageGeneration?.status || 'pending',
          audioStatus: 'none',
          isNewModel: false,
        };
        storybooksByChild.get(story.childId)?.push(item);
      }
    }

    // Fetch all storybook subcollections in parallel (was sequential — the main bottleneck)
    await Promise.all(activeStoryDocs.map(async storyDoc => {
      const story = storyDoc.data();
      const storyId = storyDoc.id;
      try {
        const storybooksSnapshot = await firestore
          .collection('stories')
          .doc(storyId)
          .collection('storybooks')
          .get();

        for (const sbDoc of storybooksSnapshot.docs) {
          const sb = sbDoc.data();

          // Skip deleted storybooks
          if (sb.deletedAt) continue;

          // Only include if pages are ready (book is viewable)
          if (sb.pageGeneration?.status !== 'ready' && sb.imageGeneration?.status !== 'ready') {
            continue;
          }

          const item: StorybookListItem = {
            storybookId: sbDoc.id,
            storyId: storyId,
            childId: story.childId,
            title: sb.title || story.metadata?.title,
            thumbnailUrl: sb.thumbnailUrl || null,
            imageStyleId: sb.imageStyleId || '',
            printLayoutId: sb.printLayoutId || null,
            createdAt: sb.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            imageGenerationStatus: sb.imageGeneration?.status || 'pending',
            pageGenerationStatus: sb.pageGeneration?.status || 'pending',
            audioStatus: 'none',
            isNewModel: true,
            printablePdfUrl: sb.finalization?.printablePdfUrl || null,
            printableCoverPdfUrl: sb.finalization?.printableCoverPdfUrl || null,
            printableInteriorPdfUrl: sb.finalization?.printableInteriorPdfUrl || null,
          };
          storybooksByChild.get(story.childId)?.push(item);
        }
      } catch (err) {
        console.error(`[GET /api/parent/storybooks] Error loading storybooks for story ${storyId}:`, err);
      }
    }));

    // If includeThumbnails is true, fetch thumbnails and audio status from pages in parallel
    if (includeThumbnails) {
      const allStorybooks = [...storybooksByChild.values()].flat();
      await Promise.all(allStorybooks.map(async sb => {
        try {
          const pagesPath = sb.isNewModel
            ? `stories/${sb.storyId}/storybooks/${sb.storybookId}/pages`
            : `stories/${sb.storyId}/outputs/storybook/pages`;

          const pagesSnapshot = await firestore
            .collection(pagesPath)
            .orderBy('pageNumber', 'asc')
            .get();

          let pagesWithAudio = 0;
          const totalPages = pagesSnapshot.size;

          for (const pageDoc of pagesSnapshot.docs) {
            const page = pageDoc.data();
            if (page.pageNumber === 0 && !sb.thumbnailUrl) {
              if (page.imageUrl && page.imageStatus === 'ready') {
                sb.thumbnailUrl = page.imageUrl;
              }
            }
            if (page.audioStatus === 'ready' && page.audioUrl) {
              pagesWithAudio++;
            }
          }

          sb.audioStatus = pagesWithAudio === 0
            ? 'none'
            : pagesWithAudio === totalPages
              ? 'ready'
              : 'partial';
        } catch (err) {
          console.error(`[GET /api/parent/storybooks] Error loading pages for storybook ${sb.storybookId}:`, err);
        }
      }));
    }

    // Build response, sorted by storybooks count (descending)
    const children: ChildWithStorybooks[] = [];
    let totalBooks = 0;

    for (const [childId, storybooks] of storybooksByChild) {
      const childInfo = childrenMap.get(childId);
      if (!childInfo) continue;

      // Sort storybooks by date, most recent first
      storybooks.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      totalBooks += storybooks.length;

      children.push({
        childId,
        displayName: childInfo.displayName,
        avatarUrl: childInfo.avatarUrl,
        storybooks,
      });
    }

    // Sort children by number of storybooks (descending)
    children.sort((a, b) => b.storybooks.length - a.storybooks.length);

    return NextResponse.json({
      children,
      totalBooks,
    } satisfies StorybooksResponse);
  } catch (error: any) {
    console.error('[GET /api/parent/storybooks] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch storybooks' },
      { status: 500 }
    );
  }
}
