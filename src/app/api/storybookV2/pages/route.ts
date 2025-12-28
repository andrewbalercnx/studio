import { NextResponse } from 'next/server';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { storyPageAudioFlow } from '@/ai/flows/story-page-audio-flow';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createLogger, generateRequestId } from '@/lib/server-logger';

// Allow up to 2 minutes for page generation
export const maxDuration = 120;

/**
 * New API route for generating pages for a StoryBookOutput.
 * Uses the new data model: stories/{storyId}/storybooks/{storybookId}/pages
 */
export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/storybookV2/pages', method: 'POST', requestId });

  const { storyId, storybookId } = await request.json();
  logger.info('Request received', { storyId, storybookId });

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
  const startTime = Date.now();

  try {
    // Step 1: Get Story document
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return NextResponse.json({ ok: false, errorMessage: `Story not found at stories/${storyId}` }, { status: 404 });
    }

    // Step 2: Get StoryBookOutput document
    const storybookRef = storyRef.collection('storybooks').doc(storybookId);
    const storybookSnap = await storybookRef.get();
    if (!storybookSnap.exists) {
      return NextResponse.json({ ok: false, errorMessage: `Storybook not found at stories/${storyId}/storybooks/${storybookId}` }, { status: 404 });
    }

    const storybookData = storybookSnap.data();
    if (storybookData?.isLocked) {
      return NextResponse.json({ ok: false, errorMessage: 'Storybook is locked.' }, { status: 409 });
    }

    // Step 3: Update status to running
    await storybookRef.update({
      'pageGeneration.status': 'running',
      'pageGeneration.lastRunAt': FieldValue.serverTimestamp(),
      'pageGeneration.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Step 4: Run page generation flow
    // Pass storyOutputTypeId from the storybook so the flow can use AI pagination
    const flowResult = await storyPageFlow({
      storyId,
      storyOutputTypeId: storybookData?.storyOutputTypeId,
    });

    if (!flowResult.ok || !flowResult.pages || flowResult.pages.length === 0) {
      const errorMessage = !flowResult.ok ? flowResult.errorMessage : 'storyPageFlow returned no pages.';
      const durationMs = Date.now() - startTime;
      logger.error('storyPageFlow failed', new Error(errorMessage ?? 'Unknown error'), { storyId, storybookId, durationMs });
      await storybookRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'pageGeneration.lastErrorMessage': errorMessage,
        'pageGeneration.diagnostics': flowResult.diagnostics ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: false, errorMessage, diagnostics: flowResult.diagnostics ?? null, requestId }, { status: 500 });
    }

    // Step 5: Write pages to storybook subcollection
    const pagesCollection = storybookRef.collection('pages');
    const existingPages = await pagesCollection.orderBy('pageNumber', 'asc').get();

    const batch = firestore.batch();
    existingPages.forEach((docSnap) => batch.delete(docSnap.ref));

    const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    sortedPages.forEach((page) => {
      const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
      const pageRef = pagesCollection.doc(pageId);
      // Filter out undefined values to avoid Firestore errors
      const pageData = Object.fromEntries(
        Object.entries(page).filter(([, value]) => value !== undefined)
      );
      batch.set(pageRef, {
        ...pageData,
        id: pageId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();

    // Step 6: Update storybook with success status
    await storybookRef.update({
      'pageGeneration.status': 'ready',
      'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
      'pageGeneration.lastErrorMessage': null,
      'pageGeneration.pagesCount': sortedPages.length,
      'pageGeneration.diagnostics': flowResult.diagnostics ?? null,
      'imageGeneration.status': 'idle',
      'imageGeneration.pagesReady': 0,
      'imageGeneration.pagesTotal': sortedPages.length,
      'imageGeneration.lastErrorMessage': null,
      'audioGeneration.status': 'pending',
      'audioGeneration.pagesReady': 0,
      'audioGeneration.pagesTotal': sortedPages.length,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Step 7: Trigger page audio generation in the background (fire-and-forget)
    // This generates narration for each page with actor descriptions
    storyPageAudioFlow({ storyId, storybookId }).catch((err) => {
      logger.error('Background page audio generation failed', err, { storyId, storybookId });
    });

    const durationMs = Date.now() - startTime;
    logger.info('Request completed successfully', { storyId, storybookId, pagesCount: sortedPages.length, durationMs });

    return NextResponse.json({
      ok: true,
      storyId,
      storybookId,
      pagesCount: sortedPages.length,
      diagnostics: flowResult.diagnostics ?? null,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    logger.error('Unhandled exception in route', error, { storyId, storybookId, durationMs });

    // Try to update status to error
    try {
      const storybookRef = firestore.collection('stories').doc(storyId).collection('storybooks').doc(storybookId);
      await storybookRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastErrorMessage': error?.message ?? 'Unknown error',
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (updateError) {
      logger.error('Failed to update error status', updateError, { storyId, storybookId });
    }

    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Unexpected /api/storybook/pages error.', requestId },
      { status: 500 }
    );
  }
}
