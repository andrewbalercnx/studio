'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { validatePageEdit, type PageEditRequestBody } from '@/lib/storybook-page-edit';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { enforcePersonaScope } from '@/lib/persona.server';

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

/**
 * POST /api/storybookV2/pageEdit
 *
 * Parent per-page clean-up (Sprint W2-C): update a single page's text and/or
 * image-generation prompt on a new-model storybook
 * (stories/{storyId}/storybooks/{storybookId}/pages/{pageId}).
 *
 * - `pageText` updates BOTH `bodyText` and `displayText` (the parent's wording
 *   becomes canonical for reader, narration, and print). Stale page audio is
 *   reset to `pending` so narration can be regenerated to match.
 * - `imagePrompt` replaces the page's art prompt. The existing image is kept
 *   until the caller triggers a single-page regeneration via
 *   POST /api/storybookV2/images { pageId, forceRegenerate: true }.
 *
 * Image regeneration deliberately stays in the images route so locking,
 * concurrency guards, artStatus rollups, and the generation flow (with its
 * circuit-breaker/reliability infra) are never duplicated.
 */
export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/storybookV2/pageEdit', method: 'POST', requestId });

  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as PageEditRequestBody;

    const validation = validatePageEdit(body);
    if (!validation.ok) {
      return respondError(400, validation.errorMessage);
    }
    const { storyId, storybookId, pageId, updates, textChanged, promptChanged } = validation;

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();

    // Ownership: the page belongs to the parent's story (or caller is privileged).
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return respondError(404, `Story not found at stories/${storyId}`);
    }
    const storyData = storySnap.data() as Record<string, any>;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && storyData.parentUid && storyData.parentUid !== user.uid) {
      return respondError(403, 'You do not own this story.');
    }

    // Persona scope: a valid child-persona cookie must match the story's
    // child. No cookie (mobile app) = legacy behaviour — see src/lib/persona.ts.
    const personaCheck = await enforcePersonaScope({
      expectedUid: user.uid,
      effectiveChildId: storyData.childId,
      claims: user.claims,
    });
    if (!personaCheck.ok) {
      return respondError(personaCheck.status, personaCheck.message);
    }

    const storybookRef = storyRef.collection('storybooks').doc(storybookId);
    const storybookSnap = await storybookRef.get();
    if (!storybookSnap.exists) {
      return respondError(404, `Storybook not found at stories/${storyId}/storybooks/${storybookId}`);
    }
    const storybookData = storybookSnap.data() as Record<string, any>;
    if (storybookData.isLocked) {
      return respondError(409, 'This book is locked for printing. Unlock it to edit pages.');
    }

    const pageRef = storybookRef.collection('pages').doc(pageId);
    const pageSnap = await pageRef.get();
    if (!pageSnap.exists) {
      return respondError(404, `Page not found at stories/${storyId}/storybooks/${storybookId}/pages/${pageId}`);
    }
    const pageData = pageSnap.data() as Record<string, any>;

    const update: Record<string, any> = {
      ...updates,
      lastEditedAt: FieldValue.serverTimestamp(),
      lastEditedBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Edited text makes existing narration stale — reset audio so the reader
    // offers regeneration instead of playing audio that no longer matches.
    let audioReset = false;
    const textActuallyChanged =
      textChanged &&
      (updates.bodyText !== (pageData.bodyText ?? '') ||
        updates.displayText !== (pageData.displayText ?? ''));
    if (textActuallyChanged && (pageData.audioUrl || pageData.audioStatus === 'ready')) {
      update.audioStatus = 'pending';
      update.audioUrl = null;
      audioReset = true;
    }

    await pageRef.update(update);
    await storybookRef.update({ updatedAt: FieldValue.serverTimestamp() });

    logger.info('Page edited', {
      storyId,
      storybookId,
      pageId,
      textChanged,
      promptChanged,
      audioReset,
      uid: user.uid,
    });

    return NextResponse.json({
      ok: true,
      storyId,
      storybookId,
      pageId,
      textChanged,
      promptChanged,
      audioReset,
      requestId,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    logger.error('Unhandled exception in pageEdit', error);
    return respondError(500, 'Unable to save the page edit right now. Please try again.');
  }
}
