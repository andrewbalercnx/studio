
import { NextResponse } from 'next/server';
import { storyPageFlow } from '@/ai/flows/story-page-flow';
import { initializeFirebase } from '@/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
  query,
  orderBy,
} from 'firebase/firestore';

export async function POST(request: Request) {
  try {
    const { storyId, regressionTag } = await request.json();

    if (!storyId || typeof storyId !== 'string') {
      return NextResponse.json({ ok: false, errorMessage: 'Missing storyId' }, { status: 400 });
    }

    const regressionMeta = regressionTag
      ? { regressionTest: true, regressionTag }
      : {};

    const { firestore } = initializeFirebase();
    const storyRef = doc(firestore, 'stories', storyId);
    const storySnap = await getDoc(storyRef);
    if (!storySnap.exists()) {
      return NextResponse.json(
        { ok: false, errorMessage: `stories/${storyId} not found.` },
        { status: 404 }
      );
    }

    const storyData = storySnap.data() as Record<string, any>;
    if (storyData?.isLocked) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Story is locked. Unlock it before regenerating pages.' },
        { status: 409 }
      );
    }
    
    // Create the output document if it doesn't exist.
    const outputRef = doc(firestore, 'stories', storyId, 'outputs', 'storybook');
    await setDoc(outputRef, { storyId, storyOutputTypeId: 'storybook', updatedAt: serverTimestamp() }, { merge: true });

    await updateDoc(outputRef, {
      'pageGeneration.status': 'running',
      'pageGeneration.lastRunAt': serverTimestamp(),
      'pageGeneration.lastErrorMessage': null,
      ...regressionMeta,
    });

    const flowResult = await storyPageFlow({ storyId });
    if (!flowResult.ok || !flowResult.pages || flowResult.pages.length === 0) {
      await updateDoc(outputRef, {
        'pageGeneration.status': 'error',
        'pageGeneration.lastCompletedAt': serverTimestamp(),
        'pageGeneration.lastErrorMessage':
          flowResult.errorMessage || 'storyPageFlow returned no pages.',
        ...regressionMeta,
      });
      return NextResponse.json(
        {
          ok: false,
          errorMessage: flowResult.errorMessage || 'storyPageFlow returned no pages.',
          diagnostics: flowResult.diagnostics ?? null,
        },
        { status: 500 }
      );
    }

    const pagesCollection = collection(firestore, 'stories', storyId, 'outputs', 'storybook', 'pages');
    const existingPages = await getDocs(query(pagesCollection, orderBy('pageNumber', 'asc')));

    const batch = writeBatch(firestore);
    existingPages.forEach((docSnap) => batch.delete(docSnap.ref));

    const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    sortedPages.forEach((page) => {
      const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
      const pageRef = doc(pagesCollection, pageId);
      batch.set(pageRef, {
        ...page,
        id: pageId, // ensure id is set
        ...regressionMeta,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();

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

    return NextResponse.json(
      {
        ok: true,
        storyId,
        pages: sortedPages,
        diagnostics: flowResult.diagnostics ?? null,
        stats: flowResult.stats ?? null,
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Unexpected /api/storyBook/pages error.' },
      { status: 500 }
    );
  }
}
