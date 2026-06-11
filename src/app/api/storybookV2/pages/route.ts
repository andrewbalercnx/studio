import { NextResponse } from 'next/server';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { storyPageAudioFlow } from '@/ai/flows/story-page-audio-flow';
import { storyExemplarGenerationFlow } from '@/ai/flows/story-exemplar-generation-flow';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { enforcePersonaScope } from '@/lib/persona.server';
import { AuthError } from '@/lib/auth-error';
import { isTestMode, buildTestModePages } from '@/lib/test-mode';
import { toUserSafeMessage } from '@/lib/ai-error-map';

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
    // Authentication: this route triggers paid AI generation, so it must never
    // run anonymously. Same gate as /api/storybookV2/create (the route that
    // precedes this one in every client flow): any authenticated Firebase user,
    // then strict ownership against story.parentUid below. We deliberately do
    // NOT require the isParent custom claim (requireParentOrAdminUser) because
    // parent roles live in Firestore, not in token claims.
    const user = await requireAuthenticatedUser(request);

    // Step 1: Get Story document
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return NextResponse.json({ ok: false, errorMessage: `Story not found at stories/${storyId}` }, { status: 404 });
    }

    // Ownership: the storybook belongs to the caller's story (or the caller is
    // privileged via admin/writer claims). Mirrors finalize/pageEdit.
    const storyData = storySnap.data() as Record<string, any>;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && storyData.parentUid && storyData.parentUid !== user.uid) {
      logger.warn('Ownership verification failed', { storyId, storybookId, uid: user.uid });
      return NextResponse.json(
        { ok: false, errorMessage: 'You do not own this story.', requestId },
        { status: 403 }
      );
    }

    // Persona scope: a valid child-persona cookie must match the story's
    // child. No cookie (mobile app) = legacy behaviour — see src/lib/persona.ts.
    const personaCheck = await enforcePersonaScope({
      expectedUid: user.uid,
      effectiveChildId: storyData.childId,
      claims: user.claims,
    });
    if (!personaCheck.ok) {
      logger.warn('Persona scope mismatch', { storyId, storybookId, uid: user.uid });
      return NextResponse.json(
        { ok: false, errorMessage: personaCheck.message, code: personaCheck.code, requestId },
        { status: personaCheck.status }
      );
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

    // TEST_MODE seam: short-circuit to deterministic fixture pages without any
    // model call, then advance the status state machine exactly as the real path
    // would. Default behaviour (flag unset) skips this block entirely.
    if (isTestMode()) {
      logger.info('TEST_MODE active — using fixture pages', { storyId, storybookId });
      const fixturePages = buildTestModePages(storyId);

      const pagesCollection = storybookRef.collection('pages');
      const existingPages = await pagesCollection.orderBy('pageNumber', 'asc').get();
      const batch = firestore.batch();
      existingPages.forEach((docSnap) => batch.delete(docSnap.ref));
      fixturePages.forEach((page) => {
        const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
        batch.set(pagesCollection.doc(pageId), {
          ...page,
          id: pageId,
          imageStatus: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();

      await storybookRef.update({
        'pageGeneration.status': 'ready',
        'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'pageGeneration.lastErrorMessage': null,
        'pageGeneration.pagesCount': fixturePages.length,
        'imageGeneration.status': 'idle',
        'imageGeneration.pagesReady': 0,
        'imageGeneration.pagesTotal': fixturePages.length,
        'imageGeneration.lastErrorMessage': null,
        'audioGeneration.status': 'pending',
        'audioGeneration.pagesReady': 0,
        'audioGeneration.pagesTotal': fixturePages.length,
        'exemplarGeneration.status': 'pending',
        'exemplarGeneration.actorsReady': 0,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Background flows are TEST_MODE-aware and will fast-advance their own status.
      storyPageAudioFlow({ storyId, storybookId }).catch((err) => {
        logger.error('Background page audio generation failed', err, { storyId, storybookId });
      });
      storyExemplarGenerationFlow({ storyId, storybookId }).catch((err) => {
        logger.error('Background exemplar generation failed', err, { storyId, storybookId });
      });

      const durationMs = Date.now() - startTime;
      logger.info('TEST_MODE page generation completed', { storyId, storybookId, pagesCount: fixturePages.length, durationMs });
      return NextResponse.json({ ok: true, storyId, storybookId, pagesCount: fixturePages.length, testMode: true });
    }

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
      // Persist a user-safe message for the client; the raw string stays in logs.
      const userSafeMessage = toUserSafeMessage(errorMessage);
      await storybookRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'pageGeneration.lastErrorMessage': userSafeMessage,
        'pageGeneration.diagnostics': flowResult.diagnostics ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: false, errorMessage: userSafeMessage, diagnostics: flowResult.diagnostics ?? null, requestId }, { status: 500 });
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
      'exemplarGeneration.status': 'pending',
      'exemplarGeneration.actorsReady': 0,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Step 7: Trigger background flows in parallel (fire-and-forget)
    // - Audio generation: narration for each page
    // - Exemplar generation: character reference sheets for consistent images
    storyPageAudioFlow({ storyId, storybookId }).catch((err) => {
      logger.error('Background page audio generation failed', err, { storyId, storybookId });
    });

    storyExemplarGenerationFlow({ storyId, storybookId }).catch((err) => {
      logger.error('Background exemplar generation failed', err, { storyId, storybookId });
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
    // Auth failures happen before any generation state is touched — return the
    // 401/403 directly without writing an error status onto the storybook.
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message, requestId },
        { status: error.status }
      );
    }
    const durationMs = Date.now() - startTime;
    logger.error('Unhandled exception in route', error, { storyId, storybookId, durationMs });
    // Never surface the raw error to the user; the raw string stays in logs above.
    const userSafeMessage = toUserSafeMessage(error);

    // Try to update status to error
    try {
      const storybookRef = firestore.collection('stories').doc(storyId).collection('storybooks').doc(storybookId);
      await storybookRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastErrorMessage': userSafeMessage,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (updateError) {
      logger.error('Failed to update error status', updateError, { storyId, storybookId });
    }

    return NextResponse.json(
      { ok: false, errorMessage: userSafeMessage, requestId },
      { status: 500 }
    );
  }
}
