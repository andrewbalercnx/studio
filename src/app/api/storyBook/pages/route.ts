
import { NextResponse } from 'next/server';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { initializeFirebase } from '@/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  orderBy,
} from 'firebase/firestore';

export async function POST(request: Request) {
  const { storyId, regressionTag } = await request.json();

  if (!storyId || typeof storyId !== 'string') {
    return NextResponse.json({ ok: false, errorMessage: 'Missing storyId' }, { status: 400 });
  }

  const { firestore } = initializeFirebase();
  const regressionMeta = regressionTag ? { regressionTest: true, regressionTag } : {};

  try {
    // Step 1: Get Story
    const storyRef = doc(firestore, 'stories', storyId);
    let storySnap;
    try {
      storySnap = await getDoc(storyRef);
      if (!storySnap.exists()) {
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
    const outputRef = doc(firestore, 'stories', storyId, 'outputs', 'storybook');
    try {
      await setDoc(outputRef, { storyId, storyOutputTypeId: 'storybook', updatedAt: serverTimestamp() }, { merge: true });
      await updateDoc(outputRef, {
        'pageGeneration.status': 'running',
        'pageGeneration.lastRunAt': serverTimestamp(),
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
       await updateDoc(outputRef, {
        'pageGeneration.status': 'error',
        'pageGeneration.lastCompletedAt': serverTimestamp(),
        'pageGeneration.lastErrorMessage': errorMessage,
        ...regressionMeta,
      });
      return NextResponse.json({ ok: false, errorMessage, diagnostics: flowResult.diagnostics ?? null }, { status: 500 });
    }

    // Step 4: Write new pages to Firestore
    try {
      const pagesCollection = collection(firestore, 'stories', storyId, 'outputs', 'storybook', 'pages');
      const existingPages = await getDocs(query(pagesCollection, orderBy('pageNumber', 'asc')));

      const batch = writeBatch(firestore);
      existingPages.forEach((docSnap) => batch.delete(docSnap.ref));

      const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
      sortedPages.forEach((page) => {
        const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
        const pageRef = doc(pagesCollection, pageId);
        batch.set(pageRef, { ...page, id: pageId, ...regressionMeta, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });

      await batch.commit();
    } catch (e: any) {
        throw new Error(`Failed to write story pages for stories/${storyId}/outputs/storybook/pages: ${e.message}`);
    }

    // Step 5: Finalize status update
    try {
        const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
        await updateDoc(outputRef, {
            'pageGeneration.status': 'ready',
            'pageGeneration.lastCompletedAt': serverTimestamp(),
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
            const sessionRef = doc(firestore, 'storySessions', sessionIdForProgress);
            await updateDoc(sessionRef, {
                'progress.pagesGeneratedAt': serverTimestamp(),
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
