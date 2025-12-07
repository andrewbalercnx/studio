
import { NextResponse } from 'next/server';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export async function POST(request: Request) {
  const { storyId, regressionTag } = await request.json();

  if (!storyId || typeof storyId !== 'string') {
    return NextResponse.json({ ok: false, errorMessage: 'Missing storyId' }, { status: 400 });
  }

  await initFirebaseAdminApp();
  const firestore = getFirestore();
  const regressionMeta = regressionTag ? { regressionTest: true, regressionTag } : {};

  try {
    // Step 1: Get Story
    const storyRef = firestore.collection('stories').doc(storyId);
    let storySnap;
    try {
      storySnap = await storyRef.get();
      if (!storySnap.exists) {
        return NextResponse.json({ ok: false, errorMessage: `Story not found at stories/${storyId}` }, { status: 404 });
      }
    } catch (e: any) {
      throw new Error(`Failed to read story document stories/${storyId}: ${e.message}`);
    }

    const storyData = storySnap.data() as Record<string, any>;
    if (storyData?.isLocked) {
      return NextResponse.json({ ok: false, errorMessage: 'Story is locked. Unlock it before regenerating pages.' }, { status: 409 });
    }

    // Step 2: Create/Update Output Doc
    const outputRef = firestore.collection('stories').doc(storyId).collection('outputs').doc('storybook');
    try {
      await outputRef.set({ storyId, storyOutputTypeId: 'storybook', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await outputRef.update({
        'pageGeneration.status': 'running',
        'pageGeneration.lastRunAt': FieldValue.serverTimestamp(),
        'pageGeneration.lastErrorMessage': null,
        ...regressionMeta,
      });
    } catch (e: any) {
        throw new Error(`Failed to update output document status for stories/${storyId}/outputs/storybook: ${e.message}`);
    }

    // Step 3: Run Page Generation Flow
    const flowResult = await storyPageFlow({ storyId });
    if (!flowResult.ok || !flowResult.pages || flowResult.pages.length === 0) {
      const errorMessage = flowResult.errorMessage || 'storyPageFlow returned no pages.';
       await outputRef.update({
        'pageGeneration.status': 'error',
        'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'pageGeneration.lastErrorMessage': errorMessage,
        ...regressionMeta,
      });
      return NextResponse.json({ ok: false, errorMessage, diagnostics: flowResult.diagnostics ?? null }, { status: 500 });
    }

    // Step 4: Write new pages to Firestore
    try {
      const pagesCollection = firestore.collection('stories').doc(storyId).collection('outputs').doc('storybook').collection('pages');
      const existingPages = await pagesCollection.orderBy('pageNumber', 'asc').get();

      const batch = firestore.batch();
      existingPages.forEach((docSnap) => batch.delete(docSnap.ref));

      const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
      sortedPages.forEach((page) => {
        const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
        const pageRef = pagesCollection.doc(pageId);
        batch.set(pageRef, { ...page, id: pageId, ...regressionMeta, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      });

      await batch.commit();
    } catch (e: any) {
        throw new Error(`Failed to write story pages for stories/${storyId}/outputs/storybook/pages: ${e.message}`);
    }

    // Step 5: Finalize status update
    try {
        const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
        await outputRef.update({
            'pageGeneration.status': 'ready',
            'pageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
            'pageGeneration.lastErrorMessage': null,
            'pageGeneration.pagesCount': sortedPages.length,
            'imageGeneration.status': 'idle',
            'imageGeneration.pagesReady': 0,
            'imageGeneration.pagesTotal': sortedPages.length,
            'imageGeneration.lastErrorMessage': null,
            'imageGeneration.lastCompletedAt': null,
            ...regressionMeta,
        });

        const sessionIdForProgress = storyData?.storySessionId;
        if (sessionIdForProgress) {
            const sessionRef = firestore.collection('storySessions').doc(sessionIdForProgress);
            await sessionRef.update({
                'progress.pagesGeneratedAt': FieldValue.serverTimestamp(),
            });
        }
        
        return NextResponse.json({
            ok: true, storyId, pages: sortedPages, diagnostics: flowResult.diagnostics ?? null, stats: flowResult.stats ?? null,
        }, { status: 200 });

    } catch (e: any) {
        throw new Error(`Failed to finalize page generation status for stories/${storyId}/outputs/storybook: ${e.message}`);
    }
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Unexpected /api/storyBook/pages error.' },
      { status: 500 }
    );
  }
}
