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

    // Step 1: Get all children for this parent
    const childrenSnapshot = await firestore
      .collection('children')
      .where('ownerParentUid', '==', parentUid)
      .get();

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

    // Step 2: Get all stories for these children
    // We query by parentUid for efficiency (single query vs. multiple child queries)
    const storiesSnapshot = await firestore
      .collection('stories')
      .where('parentUid', '==', parentUid)
      .get();

    // Group storybooks by child
    const storybooksByChild = new Map<string, StorybookListItem[]>();
    for (const childId of childrenMap.keys()) {
      storybooksByChild.set(childId, []);
    }

    // Process each story
    for (const storyDoc of storiesSnapshot.docs) {
      const story = storyDoc.data();
      const storyId = storyDoc.id;

      // Skip deleted stories
      if (story.deletedAt) continue;

      // Skip if child not in our list (shouldn't happen, but defensive)
      if (!childrenMap.has(story.childId)) continue;

      // Check legacy model storybooks (stored on story document itself)
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
          audioStatus: 'none', // Will be filled if includeThumbnails
          isNewModel: false,
        };
        storybooksByChild.get(story.childId)?.push(item);
      }

      // Check new model storybooks (subcollection)
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
            thumbnailUrl: sb.thumbnailUrl || null, // Use cached thumbnail if available
            imageStyleId: sb.imageStyleId || '',
            printLayoutId: sb.printLayoutId || null,
            createdAt: sb.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            imageGenerationStatus: sb.imageGeneration?.status || 'pending',
            pageGenerationStatus: sb.pageGeneration?.status || 'pending',
            audioStatus: 'none', // Will be calculated if includeThumbnails
            isNewModel: true,
            // Print URLs from finalization
            printablePdfUrl: sb.finalization?.printablePdfUrl || null,
            printableCoverPdfUrl: sb.finalization?.printableCoverPdfUrl || null,
            printableInteriorPdfUrl: sb.finalization?.printableInteriorPdfUrl || null,
          };
          storybooksByChild.get(story.childId)?.push(item);
        }
      } catch (err) {
        console.error(`[GET /api/parent/storybooks] Error loading storybooks for story ${storyId}:`, err);
      }
    }

    // If includeThumbnails is true, fetch thumbnails and audio status from pages
    // This is slower but provides complete data
    if (includeThumbnails) {
      for (const [childId, storybooks] of storybooksByChild) {
        for (const sb of storybooks) {
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

              // Get thumbnail from page 0 if not already set
              if (page.pageNumber === 0 && !sb.thumbnailUrl) {
                if (page.imageUrl && page.imageStatus === 'ready') {
                  sb.thumbnailUrl = page.imageUrl;
                }
              }

              // Count audio status
              if (page.audioStatus === 'ready' && page.audioUrl) {
                pagesWithAudio++;
              }
            }

            // Calculate audio status
            sb.audioStatus = pagesWithAudio === 0
              ? 'none'
              : pagesWithAudio === totalPages
                ? 'ready'
                : 'partial';
          } catch (err) {
            console.error(`[GET /api/parent/storybooks] Error loading pages for storybook ${sb.storybookId}:`, err);
          }
        }
      }
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
