import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';

/**
 * Request body for batch thumbnail fetching
 */
type ThumbnailRequest = {
  storybooks: Array<{
    storybookId: string;
    storyId: string;
    isNewModel: boolean;
  }>;
};

/**
 * Response type for thumbnail data
 */
type ThumbnailResult = {
  storybookId: string;
  thumbnailUrl: string | null;
  audioStatus: 'none' | 'partial' | 'ready';
  pagesWithAudio?: number;
  totalPages?: number;
  // Calculated image status from actual page data
  calculatedImageStatus?: string;
};

type ThumbnailsResponse = {
  thumbnails: ThumbnailResult[];
};

/**
 * POST /api/parent/storybooks/thumbnails
 * Batch fetch thumbnails and audio status for a list of storybooks.
 *
 * This endpoint is designed to be called after the initial storybooks list
 * is loaded, allowing the UI to render quickly with placeholder images
 * and then fill in the actual thumbnails.
 *
 * Request body:
 * {
 *   storybooks: [{ storybookId, storyId, isNewModel }, ...]
 * }
 *
 * Response:
 * {
 *   thumbnails: [{ storybookId, thumbnailUrl, audioStatus, pagesWithAudio, totalPages, calculatedImageStatus }, ...]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parentUid = authResult.uid;
    const body: ThumbnailRequest = await request.json();

    if (!body.storybooks || !Array.isArray(body.storybooks)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Limit batch size to prevent abuse
    const MAX_BATCH_SIZE = 50;
    if (body.storybooks.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` },
        { status: 400 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Ownership check: deduplicate by storyId (many storybooks share the same story)
    // and fetch all unique stories in parallel rather than one-per-storybook sequentially
    const uniqueStoryIds = [...new Set(body.storybooks.map(sb => sb.storyId))];
    const storyOwnershipMap = new Map<string, boolean>();
    await Promise.all(uniqueStoryIds.map(async storyId => {
      const storyDoc = await firestore.collection('stories').doc(storyId).get();
      storyOwnershipMap.set(storyId, storyDoc.exists && storyDoc.data()?.parentUid === parentUid);
    }));

    // Process all storybooks in parallel — pages queries are independent of each other
    const cacheWrites: Promise<void>[] = [];

    const results: ThumbnailResult[] = await Promise.all(body.storybooks.map(async sb => {
      try {
        if (!storyOwnershipMap.get(sb.storyId)) {
          return { storybookId: sb.storybookId, thumbnailUrl: null, audioStatus: 'none' as const };
        }

        const pagesPath = sb.isNewModel
          ? `stories/${sb.storyId}/storybooks/${sb.storybookId}/pages`
          : `stories/${sb.storyId}/outputs/storybook/pages`;

        const pagesSnapshot = await firestore
          .collection(pagesPath)
          .orderBy('pageNumber', 'asc')
          .get();

        let thumbnailUrl: string | null = null;
        let pagesWithAudio = 0;
        let pagesRequiringImages = 0;
        let pagesWithReadyImages = 0;
        let pagesWithErrorImages = 0;
        const totalPages = pagesSnapshot.size;

        for (const pageDoc of pagesSnapshot.docs) {
          const page = pageDoc.data();

          if (page.pageNumber === 0) {
            console.log(`[thumbnails] Page 0 for ${sb.storybookId}: imageUrl=${page.imageUrl ? 'yes' : 'no'}, imageStatus=${page.imageStatus}`);
            if (page.imageUrl && page.imageStatus === 'ready') {
              thumbnailUrl = page.imageUrl;
            }
          }

          if (page.audioStatus === 'ready' && page.audioUrl) {
            pagesWithAudio++;
          }

          const needsImage = page.kind !== 'title_page' && page.kind !== 'blank' && !!page.imagePrompt;
          if (needsImage) {
            pagesRequiringImages++;
            if (page.imageStatus === 'ready') pagesWithReadyImages++;
            else if (page.imageStatus === 'error') pagesWithErrorImages++;
          }
        }

        const audioStatus: 'none' | 'partial' | 'ready' =
          pagesWithAudio === 0 ? 'none' : pagesWithAudio === totalPages ? 'ready' : 'partial';

        const calculatedImageStatus: string =
          pagesRequiringImages > 0 && pagesWithReadyImages === pagesRequiringImages
            ? 'ready'
            : pagesWithErrorImages > 0
              ? 'error'
              : 'pending';

        // Queue thumbnail cache write as fire-and-forget — don't block the response
        if (thumbnailUrl && sb.isNewModel && sb.storybookId !== sb.storyId) {
          cacheWrites.push(
            firestore
              .collection('stories').doc(sb.storyId)
              .collection('storybooks').doc(sb.storybookId)
              .update({ thumbnailUrl, updatedAt: new Date() })
              .then(() => undefined)
              .catch(err => console.warn(`[thumbnails] Failed to cache thumbnail for ${sb.storybookId}:`, err))
          );
        }

        console.log(`[thumbnails] Result for ${sb.storybookId}: thumbnailUrl=${thumbnailUrl ? 'found' : 'null'}, totalPages=${totalPages}`);
        return { storybookId: sb.storybookId, thumbnailUrl, audioStatus, pagesWithAudio, totalPages, calculatedImageStatus };
      } catch (err) {
        console.error(`[POST /api/parent/storybooks/thumbnails] Error processing storybook ${sb.storybookId}:`, err);
        return { storybookId: sb.storybookId, thumbnailUrl: null, audioStatus: 'none' as const };
      }
    }));

    // Fire thumbnail cache writes after building the response (non-blocking)
    void Promise.all(cacheWrites);

    return NextResponse.json({
      thumbnails: results,
    } satisfies ThumbnailsResponse);
  } catch (error: any) {
    console.error('[POST /api/parent/storybooks/thumbnails] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch thumbnails' },
      { status: 500 }
    );
  }
}
