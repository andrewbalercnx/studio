import {NextResponse} from 'next/server';
import {storyImageFlow} from '@/ai/flows/story-image-flow';
import type {StoryBookPage} from '@/lib/types';
import {deleteStorageObject} from '@/firebase/admin/storage';
import {initFirebaseAdminApp} from '@/firebase/admin/app';
import {getFirestore, FieldValue, Firestore} from 'firebase-admin/firestore';
import {initializeFirebase} from '@/firebase';
import {logSessionEvent} from '@/lib/session-events';

type ImageJobRequest = {
  bookId: string;
  forceRegenerate?: boolean;
  regressionTag?: string;
  pageId?: string;
};

type PageWithId = StoryBookPage & {id: string};

async function getAdminFirestore() {
  const app = await initFirebaseAdminApp();
  return getFirestore(app);
}

async function loadPages(firestore: Firestore, bookId: string, pageId?: string): Promise<PageWithId[]> {
  const pagesRef = firestore.collection('storyBooks').doc(bookId).collection('pages');
  if (pageId) {
    const pageSnap = await pagesRef.doc(pageId).get();
    if (!pageSnap.exists) {
      throw new Error(`storyBooks/${bookId}/pages/${pageId} not found.`);
    }
    return [{...(pageSnap.data() as StoryBookPage), id: pageSnap.id}];
  }

  const snapshot = await pagesRef.orderBy('pageNumber', 'asc').get();
  return snapshot.docs.map((docSnap) => ({
    ...(docSnap.data() as StoryBookPage),
    id: docSnap.id,
  }));
}

async function resetPageState(
  firestore: Firestore,
  bookId: string,
  page: PageWithId,
  regressionMeta: Record<string, unknown>,
  forceRegenerate: boolean
) {
  const pageRef = firestore.collection('storyBooks').doc(bookId).collection('pages').doc(page.id);
  if (forceRegenerate && page.imageMetadata?.storagePath) {
    await deleteStorageObject(page.imageMetadata.storagePath).catch(() => undefined);
  }
  await pageRef.update({
    imageStatus: 'pending',
    imageUrl: null,
    'imageMetadata.lastErrorMessage': null,
    'imageMetadata.storagePath': null,
    'imageMetadata.downloadToken': null,
    'imageMetadata.generatedAt': null,
    updatedAt: FieldValue.serverTimestamp(),
    ...regressionMeta,
  });
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
    {ready: 0, total: 0, errors: 0}
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ImageJobRequest;
    const {bookId, forceRegenerate = false, regressionTag, pageId} = body;
    if (!bookId || typeof bookId !== 'string') {
      return NextResponse.json({ok: false, errorMessage: 'Missing bookId'}, {status: 400});
    }

    const firestore = await getAdminFirestore();
    const bookRef = firestore.collection('storyBooks').doc(bookId);
    const bookSnap = await bookRef.get();
    if (!bookSnap.exists) {
      return NextResponse.json(
        {ok: false, errorMessage: `storyBooks/${bookId} not found.`},
        {status: 404}
      );
    }
    const bookData = (bookSnap.data() as Record<string, any>) ?? {};
    if (bookData?.isLocked) {
      return NextResponse.json(
        {ok: false, errorMessage: 'Storybook is locked. Unlock it before regenerating artwork.'},
        {status: 409}
      );
    }
    const sessionIdForProgress = bookData?.storySessionId ?? null;

    const regressionMeta = regressionTag
      ? {regressionTest: true, regressionTag}
      : {};

    await bookRef.update({
      'imageGeneration.status': 'running',
      'imageGeneration.lastRunAt': FieldValue.serverTimestamp(),
      'imageGeneration.lastErrorMessage': null,
      ...regressionMeta,
    });

    const pages = await loadPages(firestore, bookId, pageId);
    if (pages.length === 0) {
      return NextResponse.json(
        {ok: false, errorMessage: 'No pages available for this storyBook.'},
        {status: 400}
      );
    }

    const logs: string[] = [];
    for (const page of pages) {
      if (!page.imagePrompt || page.imagePrompt.trim().length === 0) {
        logs.push(`[skip] ${page.id} has no imagePrompt.`);
        await firestore
          .collection('storyBooks')
          .doc(bookId)
          .collection('pages')
          .doc(page.id)
          .update({
            imageStatus: 'error',
            'imageMetadata.lastErrorMessage': 'Missing imagePrompt.',
            updatedAt: FieldValue.serverTimestamp(),
          });
        continue;
      }

      if (!forceRegenerate && page.imageStatus === 'ready' && page.imageUrl) {
        logs.push(`[skip] ${page.id} already ready.`);
        continue;
      }

      await resetPageState(firestore, bookId, page, regressionMeta, forceRegenerate);
      const flowResult = await storyImageFlow({
        bookId,
        pageId: page.id,
        regressionTag,
        forceRegenerate,
      });

      if (!flowResult.ok) {
        logs.push(`[error] ${page.id}: ${flowResult.errorMessage}`);
      } else {
        logs.push(`[ready] ${page.id}`);
      }
    }

    const refreshedPages = await loadPages(firestore, bookId);
    const counts = summarizeCounts(refreshedPages);
    const finalStatus = counts.ready === counts.total ? 'ready' : 'error';

    await bookRef.update({
      'imageGeneration.status': finalStatus,
      'imageGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
      'imageGeneration.lastErrorMessage':
        finalStatus === 'ready' ? null : 'One or more pages failed to render.',
      'imageGeneration.pagesReady': counts.ready,
      'imageGeneration.pagesTotal': counts.total,
      ...regressionMeta,
    });

    if (sessionIdForProgress) {
      await logSessionEvent({
        firestore: initializeFirebase().firestore,
        sessionId: sessionIdForProgress,
        event: 'art.generated',
        status: finalStatus === 'ready' ? 'completed' : 'error',
        source: 'server',
        attributes: {
          bookId,
          ready: counts.ready,
          total: counts.total,
        },
      });
      if (finalStatus === 'ready') {
        await firestore.collection('storySessions').doc(sessionIdForProgress).update({
          'progress.artGeneratedAt': FieldValue.serverTimestamp(),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      bookId,
      status: finalStatus,
      ready: counts.ready,
      total: counts.total,
      logs,
    });
  } catch (error: any) {
    console.error('[storyBook/images] error', error);
    return NextResponse.json(
      {ok: false, errorMessage: error?.message ?? 'Unexpected /api/storyBook/images error.'},
      {status: 500}
    );
  }
}
