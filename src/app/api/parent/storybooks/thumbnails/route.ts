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

    const results: ThumbnailResult[] = [];

    // Process each storybook
    for (const sb of body.storybooks) {
      try {
        // Verify ownership by checking the story belongs to this parent
        const storyDoc = await firestore.collection('stories').doc(sb.storyId).get();
        if (!storyDoc.exists || storyDoc.data()?.parentUid !== parentUid) {
          // Skip - not authorized to access this storybook
          results.push({
            storybookId: sb.storybookId,
            thumbnailUrl: null,
            audioStatus: 'none',
          });
          continue;
        }

        // Determine pages path based on model type
        const pagesPath = sb.isNewModel
          ? `stories/${sb.storyId}/storybooks/${sb.storybookId}/pages`
          : `stories/${sb.storyId}/outputs/storybook/pages`;

        const pagesSnapshot = await firestore
          .collection(pagesPath)
          .orderBy('pageNumber', 'asc')
          .get();

        let thumbnailUrl: string | null = null;
        let pagesWithAudio = 0;
        const totalPages = pagesSnapshot.size;

        // Track image status for pages that require images
        let pagesRequiringImages = 0;
        let pagesWithReadyImages = 0;
        let pagesWithErrorImages = 0;

        for (const pageDoc of pagesSnapshot.docs) {
          const page = pageDoc.data();

          // Get thumbnail from page 0 (cover page)
          if (page.pageNumber === 0) {
            console.log(`[thumbnails] Page 0 for ${sb.storybookId}: imageUrl=${page.imageUrl ? 'yes' : 'no'}, imageStatus=${page.imageStatus}`);
            if (page.imageUrl && page.imageStatus === 'ready') {
              thumbnailUrl = page.imageUrl;
            }
          }

          // Count audio status
          if (page.audioStatus === 'ready' && page.audioUrl) {
            pagesWithAudio++;
          }

          // Calculate image status - exclude title_page and blank pages
          const needsImage = page.kind !== 'title_page' && page.kind !== 'blank' && !!page.imagePrompt;
          if (needsImage) {
            pagesRequiringImages++;
            if (page.imageStatus === 'ready') {
              pagesWithReadyImages++;
            } else if (page.imageStatus === 'error') {
              pagesWithErrorImages++;
            }
          }
        }

        // Calculate audio status
        const audioStatus: 'none' | 'partial' | 'ready' =
          pagesWithAudio === 0
            ? 'none'
            : pagesWithAudio === totalPages
              ? 'ready'
              : 'partial';

        // Calculate actual image generation status from page data
        const calculatedImageStatus: string =
          pagesRequiringImages > 0 && pagesWithReadyImages === pagesRequiringImages
            ? 'ready'
            : pagesWithErrorImages > 0
              ? 'error'
              : 'pending';

        // Cache the thumbnail on the storybook document if we found one and it's a new model
        if (thumbnailUrl && sb.isNewModel && sb.storybookId !== sb.storyId) {
          try {
            await firestore
              .collection('stories')
              .doc(sb.storyId)
              .collection('storybooks')
              .doc(sb.storybookId)
              .update({
                thumbnailUrl,
                updatedAt: new Date(),
              });
          } catch (cacheError) {
            // Non-fatal - just log and continue
            console.warn(`[POST /api/parent/storybooks/thumbnails] Failed to cache thumbnail for ${sb.storybookId}:`, cacheError);
          }
        }

        console.log(`[thumbnails] Result for ${sb.storybookId}: thumbnailUrl=${thumbnailUrl ? 'found' : 'null'}, totalPages=${totalPages}`);
        results.push({
          storybookId: sb.storybookId,
          thumbnailUrl,
          audioStatus,
          pagesWithAudio,
          totalPages,
          calculatedImageStatus,
        });
      } catch (err) {
        console.error(`[POST /api/parent/storybooks/thumbnails] Error processing storybook ${sb.storybookId}:`, err);
        results.push({
          storybookId: sb.storybookId,
          thumbnailUrl: null,
          audioStatus: 'none',
        });
      }
    }

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
