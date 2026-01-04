import { NextResponse } from 'next/server';
import { storyImageFlow } from '@/ai/flows/story-image-flow';
import type { StoryOutputPage, PrintLayout } from '@/lib/types';
import { DEFAULT_PRINT_LAYOUT_ID } from '@/lib/types';
import { deleteStorageObject } from '@/firebase/admin/storage';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { mapPageKindToLayoutType, calculateImageDimensionsForPageType, getAspectRatioForPageType } from '@/lib/print-layout-utils';
import { createLogger, generateRequestId } from '@/lib/server-logger';

// Allow up to 5 minutes for image generation (can take a while with many pages)
export const maxDuration = 300;

type ImageJobRequest = {
  storyId: string;
  storybookId: string;
  forceRegenerate?: boolean;
  pageId?: string;
  // New fields for dimension-aware generation
  imageStylePrompt?: string;
  targetWidthPx?: number;
  targetHeightPx?: number;
};

type PageWithId = StoryOutputPage & { id: string };

async function loadPages(
  firestore: Firestore,
  storyId: string,
  storybookId: string,
  pageId?: string
): Promise<PageWithId[]> {
  const pagesRef = firestore
    .collection('stories')
    .doc(storyId)
    .collection('storybooks')
    .doc(storybookId)
    .collection('pages');

  if (pageId) {
    const pageSnap = await pagesRef.doc(pageId).get();
    if (!pageSnap.exists) {
      throw new Error(`Page not found at stories/${storyId}/storybooks/${storybookId}/pages/${pageId}`);
    }
    return [{ ...(pageSnap.data() as StoryOutputPage), id: pageSnap.id }];
  }

  const snapshot = await pagesRef.orderBy('pageNumber', 'asc').get();
  return snapshot.docs.map((docSnap) => ({
    ...(docSnap.data() as StoryOutputPage),
    id: docSnap.id,
  }));
}

function summarizeCounts(pages: PageWithId[]) {
  return pages.reduce(
    (acc, page) => {
      acc.total += 1;
      if (page.imageStatus === 'ready') {
        acc.ready += 1;
      } else if (page.imageStatus === 'error') {
        acc.errors += 1;
      }
      return acc;
    },
    { ready: 0, total: 0, errors: 0 }
  );
}

/**
 * Check if an error message indicates a rate limit was hit
 */
function isRateLimitError(errorMessage: string): boolean {
  const rateLimitPatterns = [
    'RESOURCE_EXHAUSTED',
    '429',
    'quota',
    'rate limit',
    'Rate limit',
    'timed out',
    'too many requests',
    'Too Many Requests',
  ];
  return rateLimitPatterns.some(pattern => errorMessage.includes(pattern));
}

/**
 * Calculate when to retry after a rate limit (1 hour from now)
 */
function calculateRetryTime(): Date {
  const retryTime = new Date();
  retryTime.setHours(retryTime.getHours() + 1);
  return retryTime;
}

/**
 * New API route for generating images for a StoryBookOutput.
 * Uses the new data model: stories/{storyId}/storybooks/{storybookId}/pages
 * Supports dimension-aware image generation.
 */
export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/storybookV2/images', method: 'POST', requestId });
  const allLogs: string[] = [];
  let storyIdFromRequest: string | undefined;
  let storybookIdFromRequest: string | undefined;
  const startTime = Date.now();

  try {
    const body = (await request.json()) as ImageJobRequest;
    const {
      storyId,
      storybookId,
      forceRegenerate = false,
      pageId,
      imageStylePrompt,
      targetWidthPx,
      targetHeightPx,
    } = body;

    storyIdFromRequest = storyId;
    storybookIdFromRequest = storybookId;

    logger.info('Request received', { storyId, storybookId, pageId: pageId || 'all', forceRegenerate });

    if (!storyId || typeof storyId !== 'string') {
      logger.warn('Missing storyId in request');
      return NextResponse.json({ ok: false, errorMessage: 'Missing storyId', requestId }, { status: 400 });
    }

    if (!storybookId || typeof storybookId !== 'string') {
      logger.warn('Missing storybookId in request');
      return NextResponse.json({ ok: false, errorMessage: 'Missing storybookId', requestId }, { status: 400 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Get storybook reference
    const storybookRef = firestore
      .collection('stories')
      .doc(storyId)
      .collection('storybooks')
      .doc(storybookId);

    const storybookSnap = await storybookRef.get();
    if (!storybookSnap.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: `Storybook not found at stories/${storyId}/storybooks/${storybookId}` },
        { status: 404 }
      );
    }

    const storybookData = storybookSnap.data();
    if (storybookData?.isLocked) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Storybook is locked.' },
        { status: 409 }
      );
    }

    // Update status to running
    await storybookRef.update({
      'imageGeneration.status': 'running',
      'imageGeneration.lastRunAt': FieldValue.serverTimestamp(),
      'imageGeneration.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Load the print layout for page-type-aware image dimensions
    // Fall back to DEFAULT_PRINT_LAYOUT_ID if storybook doesn't have one set
    let printLayout: PrintLayout | null = null;
    const printLayoutId = storybookData?.printLayoutId || DEFAULT_PRINT_LAYOUT_ID;
    const layoutDoc = await firestore.collection('printLayouts').doc(printLayoutId).get();
    if (layoutDoc.exists) {
      printLayout = { id: layoutDoc.id, ...layoutDoc.data() } as PrintLayout;
      allLogs.push(`[layout] Loaded print layout: ${printLayoutId}${!storybookData?.printLayoutId ? ' (default)' : ''}`);
    } else {
      allLogs.push(`[layout] Warning: Print layout ${printLayoutId} not found, dimensions may be missing`);
    }

    // Load pages
    const pages = await loadPages(firestore, storyId, storybookId, pageId);
    if (pages.length === 0) {
      return NextResponse.json(
        { ok: false, errorMessage: 'No pages available for this storybook.' },
        { status: 400 }
      );
    }

    // Default dimensions: 8x8 inches at 300 DPI = 2400x2400 pixels (standard children's book size)
    const DEFAULT_IMAGE_WIDTH_PX = 2400;
    const DEFAULT_IMAGE_HEIGHT_PX = 2400;

    // Prepare all pages for parallel processing
    const pageJobs: Array<{
      page: PageWithId;
      needsGeneration: boolean;
      flowInput?: Parameters<typeof storyImageFlow>[0];
      skipReason?: string;
    }> = [];

    // First pass: determine which pages need generation and prepare their inputs
    for (const page of pages) {
      // Skip pages that don't need images:
      // 1. Pages without imagePrompt (title_page without prompt)
      // 2. Blank pages (decorative - they have imagePrompts but we skip actual generation)
      if (!page.imagePrompt || page.imagePrompt.trim().length === 0 || page.kind === 'blank') {
        pageJobs.push({
          page,
          needsGeneration: false,
          skipReason: `${page.id} (${page.kind || 'unknown'}) - no image generation needed.`,
        });
        continue;
      }

      if (!forceRegenerate && page.imageStatus === 'ready' && page.imageUrl) {
        pageJobs.push({
          page,
          needsGeneration: false,
          skipReason: `${page.id} already ready.`,
        });
        continue;
      }

      // Determine page-type-aware dimensions
      let pageTargetWidthPx: number;
      let pageTargetHeightPx: number;
      let pageAspectRatio: string;

      // If we have a print layout, calculate dimensions from it (most accurate)
      if (printLayout) {
        const pageType = page.kind ? mapPageKindToLayoutType(page.kind) : 'inside';
        const dimensions = calculateImageDimensionsForPageType(printLayout, pageType);
        pageTargetWidthPx = dimensions.widthPx;
        pageTargetHeightPx = dimensions.heightPx;
        pageAspectRatio = getAspectRatioForPageType(printLayout, pageType);
        allLogs.push(`[dimensions] Page ${page.id} (${page.kind || 'default'} -> ${pageType}): ${pageTargetWidthPx}x${pageTargetHeightPx}px, aspect=${pageAspectRatio}`);
      } else {
        pageTargetWidthPx = targetWidthPx ?? storybookData?.imageWidthPx ?? DEFAULT_IMAGE_WIDTH_PX;
        pageTargetHeightPx = targetHeightPx ?? storybookData?.imageHeightPx ?? DEFAULT_IMAGE_HEIGHT_PX;
        if (pageTargetWidthPx > pageTargetHeightPx) {
          pageAspectRatio = '4:3';
        } else if (pageTargetWidthPx < pageTargetHeightPx) {
          pageAspectRatio = '3:4';
        } else {
          pageAspectRatio = '1:1';
        }
        allLogs.push(`[dimensions] Page ${page.id}: ${pageTargetWidthPx}x${pageTargetHeightPx}px, aspect=${pageAspectRatio} (fallback - no layout)`);
      }

      pageJobs.push({
        page,
        needsGeneration: true,
        flowInput: {
          storyId,
          pageId: page.id,
          forceRegenerate,
          storybookId,
          imageStylePrompt: imageStylePrompt || storybookData?.imageStylePrompt || undefined,
          imageStyleId: storybookData?.imageStyleId || undefined,
          aspectRatio: pageAspectRatio,
          targetWidthPx: pageTargetWidthPx,
          targetHeightPx: pageTargetHeightPx,
        },
      });
    }

    // Process skipped pages (mark as ready) and reset pages that need generation
    const prepPromises: Promise<void>[] = [];
    for (const job of pageJobs) {
      const pageRef = storybookRef.collection('pages').doc(job.page.id);

      if (!job.needsGeneration) {
        allLogs.push(`[skip] ${job.skipReason}`);
        // Mark skipped pages as ready (they don't need AI images)
        if (job.page.imageStatus !== 'ready') {
          prepPromises.push(
            pageRef.update({
              imageStatus: 'ready',
              updatedAt: FieldValue.serverTimestamp(),
            }).then(() => undefined)
          );
        }
      } else {
        // Reset page state for pages that need generation
        if (forceRegenerate && job.page.imageMetadata?.storagePath) {
          prepPromises.push(
            deleteStorageObject(job.page.imageMetadata.storagePath).catch(() => {}).then(() => undefined)
          );
        }
        prepPromises.push(
          pageRef.update({
            imageStatus: 'pending',
            imageUrl: null,
            'imageMetadata.lastErrorMessage': null,
            'imageMetadata.storagePath': null,
            'imageMetadata.downloadToken': null,
            'imageMetadata.generatedAt': null,
            updatedAt: FieldValue.serverTimestamp(),
          }).then(() => undefined)
        );
      }
    }
    await Promise.all(prepPromises);

    // Generate images with controlled concurrency to avoid overwhelming the API
    const jobsNeedingGeneration = pageJobs.filter(job => job.needsGeneration && job.flowInput);
    const CONCURRENCY_LIMIT = 3; // Process 3 images at a time to avoid rate limits
    allLogs.push(`[parallel] Starting ${jobsNeedingGeneration.length} image generation jobs (concurrency: ${CONCURRENCY_LIMIT})`);

    // Initialize progress counters before starting parallel generation
    // pagesReady starts at 0, each storyImageFlow will atomically increment it
    // pagesTotal is set upfront so the progress bar can calculate percentage
    await storybookRef.update({
      'imageGeneration.pagesReady': 0,
      'imageGeneration.pagesTotal': jobsNeedingGeneration.length,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Process in batches with concurrency limit
    const imageResults: Array<{ pageId: string; flowResult: Awaited<ReturnType<typeof storyImageFlow>> }> = [];

    for (let i = 0; i < jobsNeedingGeneration.length; i += CONCURRENCY_LIMIT) {
      const batch = jobsNeedingGeneration.slice(i, i + CONCURRENCY_LIMIT);
      allLogs.push(`[batch] Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(jobsNeedingGeneration.length / CONCURRENCY_LIMIT)} (${batch.length} images)`);

      const batchPromises = batch.map(async (job) => {
        try {
          const flowResult = await storyImageFlow(job.flowInput!);
          return { pageId: job.page.id, flowResult };
        } catch (flowError: any) {
          const errorStack = flowError?.stack || 'No stack trace';
          console.error(`[images/route] storyImageFlow exception for ${job.page.id}:`, flowError?.message);
          console.error(`[images/route] Stack:`, errorStack);
          allLogs.push(`[error] ${job.page.id} threw exception: ${flowError?.message || flowError}`);
          allLogs.push(`[stack] ${errorStack.substring(0, 300)}`);
          return {
            pageId: job.page.id,
            flowResult: {
              ok: false as const,
              storyId: job.flowInput!.storyId,
              pageId: job.page.id,
              imageStatus: 'error' as const,
              errorMessage: flowError?.message || 'Unknown error in storyImageFlow',
              logs: [`Exception: ${flowError?.message || flowError}`, `Stack: ${errorStack.substring(0, 500)}`],
            },
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      imageResults.push(...batchResults);
    }

    // Collect results and logs, detect rate limit errors
    let hasRateLimitError = false;
    let rateLimitErrorMessage = '';

    for (const { pageId, flowResult } of imageResults) {
      if (flowResult.logs) {
        allLogs.push(...flowResult.logs);
      }
      if (!flowResult.ok) {
        allLogs.push(`[error] ${pageId}: ${flowResult.errorMessage}`);
        // Check if this is a rate limit error
        if (flowResult.errorMessage && isRateLimitError(flowResult.errorMessage)) {
          hasRateLimitError = true;
          rateLimitErrorMessage = flowResult.errorMessage;
        }
      } else {
        allLogs.push(`[ready] ${pageId} imageUrl=${flowResult.imageUrl?.substring(0, 100)}...`);
      }
    }

    // Update progress counter once after all jobs complete
    const currentCounts = summarizeCounts(await loadPages(firestore, storyId, storybookId));
    await storybookRef.update({
      'imageGeneration.pagesReady': currentCounts.ready,
      'imageGeneration.pagesTotal': currentCounts.total,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Final status update - check for rate limit vs regular error
    const refreshedPages = await loadPages(firestore, storyId, storybookId);
    const counts = summarizeCounts(refreshedPages);

    let finalStatus: 'ready' | 'error' | 'rate_limited';
    let finalErrorMessage: string | null = null;

    if (counts.ready === counts.total) {
      finalStatus = 'ready';
    } else if (hasRateLimitError) {
      finalStatus = 'rate_limited';
      finalErrorMessage = 'The Story Wizard is taking a nap! We\'ll try again soon.';
      allLogs.push(`[rate_limited] Detected rate limit error, scheduling retry in 1 hour`);
    } else {
      finalStatus = 'error';
      finalErrorMessage = 'One or more pages failed to render.';
    }

    // Build the update object
    const statusUpdate: Record<string, any> = {
      'imageGeneration.status': finalStatus,
      'imageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
      'imageGeneration.lastErrorMessage': finalErrorMessage,
      'imageGeneration.pagesReady': counts.ready,
      'imageGeneration.pagesTotal': counts.total,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // If rate limited, schedule a retry
    if (finalStatus === 'rate_limited') {
      const retryTime = calculateRetryTime();
      const currentRetryCount = storybookData?.imageGeneration?.rateLimitRetryCount || 0;
      statusUpdate['imageGeneration.rateLimitRetryAt'] = retryTime;
      statusUpdate['imageGeneration.rateLimitRetryCount'] = currentRetryCount + 1;
      allLogs.push(`[retry] Scheduled retry at ${retryTime.toISOString()} (attempt ${currentRetryCount + 1})`);
    }

    await storybookRef.update(statusUpdate);

    const durationMs = Date.now() - startTime;
    if (finalStatus === 'ready') {
      logger.info('Request completed successfully', { storyId, storybookId, ready: counts.ready, total: counts.total, durationMs });
    } else if (finalStatus === 'rate_limited') {
      logger.warn('Request completed with rate limit', { storyId, storybookId, ready: counts.ready, total: counts.total, durationMs });
    } else {
      logger.error('Request completed with errors', new Error(finalErrorMessage ?? 'Unknown error'), { storyId, storybookId, ready: counts.ready, total: counts.total, durationMs });
    }

    return NextResponse.json({
      ok: finalStatus === 'ready',
      storyId,
      storybookId,
      status: finalStatus,
      ready: counts.ready,
      total: counts.total,
      rateLimited: hasRateLimitError,
      retryAt: hasRateLimitError ? calculateRetryTime().toISOString() : undefined,
      logs: allLogs,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    logger.error('Unhandled exception in route', error, { storyId: storyIdFromRequest, storybookId: storybookIdFromRequest, durationMs });
    const errorMessage = error?.message ?? 'Unknown error';
    const isRateLimit = isRateLimitError(errorMessage);

    // Try to update status
    if (storyIdFromRequest && storybookIdFromRequest) {
      try {
        const firestore = getFirestore();
        const storybookRef = firestore
          .collection('stories')
          .doc(storyIdFromRequest)
          .collection('storybooks')
          .doc(storybookIdFromRequest);

        if (isRateLimit) {
          // Rate limit at top level - schedule retry
          const retryTime = calculateRetryTime();
          const storybookSnap = await storybookRef.get();
          const currentRetryCount = storybookSnap.data()?.imageGeneration?.rateLimitRetryCount || 0;

          await storybookRef.update({
            'imageGeneration.status': 'rate_limited',
            'imageGeneration.lastErrorMessage': 'The Story Wizard is taking a nap! We\'ll try again soon.',
            'imageGeneration.rateLimitRetryAt': retryTime,
            'imageGeneration.rateLimitRetryCount': currentRetryCount + 1,
            updatedAt: FieldValue.serverTimestamp(),
          });
          allLogs.push(`[rate_limited] Top-level rate limit, retry at ${retryTime.toISOString()}`);
        } else {
          await storybookRef.update({
            'imageGeneration.status': 'error',
            'imageGeneration.lastErrorMessage': errorMessage,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (updateError) {
        console.error('[storybook/images] Failed to update error status:', updateError);
      }
    }

    return NextResponse.json(
      {
        ok: false,
        errorMessage: isRateLimit
          ? 'The Story Wizard is taking a nap! We\'ll try again soon.'
          : errorMessage,
        rateLimited: isRateLimit,
        retryAt: isRateLimit ? calculateRetryTime().toISOString() : undefined,
        logs: allLogs,
        storyId: storyIdFromRequest,
        storybookId: storybookIdFromRequest,
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
