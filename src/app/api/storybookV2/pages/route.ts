import { NextResponse } from 'next/server';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { storyPageAudioFlow } from '@/ai/flows/story-page-audio-flow';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * New API route for generating pages for a StoryBookOutput.
 * Uses the new data model: stories/{storyId}/storybooks/{storybookId}/pages
 */
export async function POST(request: Request) {
  const { storyId, storybookId } = await request.json();

  if (!storyId || typeof storyId !== 'string') {
    return NextResponse.json({ ok: false, errorMessage: 'Missing storyId' }, { status: 400 });
  }

  if (!storybookId || typeof storybookId !== 'string') {
    return NextResponse.json({ ok: false, errorMessage: 'Missing storybookId' }, { status: 400 });
  }

  await initFirebaseAdminApp();
  const firestore = getFirestore();

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
    // Note: The flow currently reads from the main story document
    const flowResult = await storyPageFlow({
      storyId,
    });

    if (!flowResult.ok || !flowResult.pages || flowResult.pages.length === 0) {
      const errorMessage = !flowResult.ok ? flowResult.errorMessage : 'storyPageFlow returned no pages.';
      await storybookRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'pageGeneration.lastErrorMessage': errorMessage,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: false, errorMessage, diagnostics: flowResult.diagnostics ?? null }, { status: 500 });
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
      batch.set(pageRef, {
        ...page,
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
      console.error('[storybookV2/pages] Background page audio generation failed:', err);
    });

    return NextResponse.json({
      ok: true,
      storyId,
      storybookId,
      pagesCount: sortedPages.length,
      diagnostics: flowResult.diagnostics ?? null,
    });
  } catch (error: any) {
    // Try to update status to error
    try {
      const storybookRef = firestore.collection('stories').doc(storyId).collection('storybooks').doc(storybookId);
      await storybookRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastErrorMessage': error?.message ?? 'Unknown error',
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (updateError) {
      console.error('[storybook/pages] Failed to update error status:', updateError);
    }

    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Unexpected /api/storybook/pages error.' },
      { status: 500 }
    );
  }
}
