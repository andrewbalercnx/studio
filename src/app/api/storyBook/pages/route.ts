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
    const { bookId, regressionTag } = await request.json();

    if (!bookId || typeof bookId !== 'string') {
      return NextResponse.json({ ok: false, errorMessage: 'Missing bookId' }, { status: 400 });
    }

    const regressionMeta = regressionTag
      ? { regressionTest: true, regressionTag }
      : {};

    const { firestore } = initializeFirebase();
    const bookRef = doc(firestore, 'storyBooks', bookId);
    const bookSnap = await getDoc(bookRef);
    if (!bookSnap.exists()) {
      return NextResponse.json(
        { ok: false, errorMessage: `storyBooks/${bookId} not found.` },
        { status: 404 }
      );
    }

    const bookData = bookSnap.data() as Record<string, any>;
    if (bookData?.isLocked) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Storybook is locked. Unlock it before regenerating pages.' },
        { status: 409 }
      );
    }

    await updateDoc(bookRef, {
      'pageGeneration.status': 'running',
      'pageGeneration.lastRunAt': serverTimestamp(),
      'pageGeneration.lastErrorMessage': null,
      ...regressionMeta,
    });

    const flowResult = await storyPageFlow({ bookId });
    if (!flowResult.ok || !flowResult.pages || flowResult.pages.length === 0) {
      await updateDoc(bookRef, {
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

    const pagesCollection = collection(firestore, 'storyBooks', bookId, 'pages');
    const existingPages = await getDocs(query(pagesCollection, orderBy('pageNumber', 'asc')));

    const batch = writeBatch(firestore);
    existingPages.forEach((docSnap) => batch.delete(docSnap.ref));

    const sortedPages = [...flowResult.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    sortedPages.forEach((page) => {
      const pageId = `page-${String(page.pageNumber).padStart(3, '0')}`;
      const pageRef = doc(pagesCollection, pageId);
      batch.set(pageRef, {
        ...page,
        ...regressionMeta,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();

    await updateDoc(bookRef, {
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

    const sessionIdForProgress = bookData?.storySessionId;
    if (sessionIdForProgress) {
      const sessionRef = doc(firestore, 'storySessions', sessionIdForProgress);
      await updateDoc(sessionRef, {
        'progress.pagesGeneratedAt': serverTimestamp(),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        bookId,
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
