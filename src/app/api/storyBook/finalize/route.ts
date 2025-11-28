'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';

type FinalizeRequest = {
  bookId: string;
  action?: 'finalize' | 'unlock';
  regressionTag?: string;
};

type StoryBookDoc = FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;

async function getBook(
  firestore: Firestore,
  bookId: string
): Promise<StoryBookDoc> {
  const doc = await firestore.collection('storyBooks').doc(bookId).get();
  return doc;
}

async function loadPages(
  firestore: Firestore,
  bookId: string
) {
  const pagesSnap = await firestore
    .collection('storyBooks')
    .doc(bookId)
    .collection('pages')
    .orderBy('pageNumber', 'asc')
    .get();
  return pagesSnap.docs.map((docSnap) => docSnap.data() ?? {});
}

async function logSessionEvent(firestore: Firestore, sessionId: string, event: string, attributes: Record<string, unknown>) {
  try {
    await firestore
      .collection('storySessions')
      .doc(sessionId)
      .collection('events')
      .add({
        event,
        status: 'completed',
        source: 'server',
        attributes,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.warn('[storybook/finalize] Failed to log session event', error);
  }
}

async function revokeActiveShareToken(
  firestore: Firestore,
  bookId: string,
  shareId?: string | null,
  uid?: string
) {
  if (!shareId) return;
  try {
    await firestore
      .collection('storyBooks')
      .doc(bookId)
      .collection('shareTokens')
      .doc(shareId)
      .set(
        {
          status: 'revoked',
          revokedAt: FieldValue.serverTimestamp(),
          revokedBy: uid ?? null,
        },
        { merge: true }
      );
  } catch (error) {
    console.warn('[storybook/finalize] Failed to revoke share token', error);
  }
}

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as FinalizeRequest;
    const { bookId, action = 'finalize', regressionTag } = body;
    if (!bookId || typeof bookId !== 'string') {
      return respondError(400, 'Missing bookId');
    }
    if (!['finalize', 'unlock'].includes(action)) {
      return respondError(400, `Unsupported action "${action}"`);
    }

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const bookSnap = await getBook(firestore, bookId);
    if (!bookSnap.exists) {
      return respondError(404, `storyBooks/${bookId} not found`);
    }
    const bookData = (bookSnap.data() as Record<string, any>) || {};
    const parentUid = bookData.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this storybook.');
    }

    if (action === 'unlock') {
      await revokeActiveShareToken(firestore, bookId, bookData?.storybookFinalization?.shareId, user.uid);
      await bookSnap.ref.update({
        isLocked: false,
        'storybookFinalization.status': 'draft',
        'storybookFinalization.unlockedAt': FieldValue.serverTimestamp(),
        'storybookFinalization.shareId': null,
        'storybookFinalization.shareLink': null,
        'storybookFinalization.shareExpiresAt': null,
        'storybookFinalization.shareRequiresPasscode': false,
        'storybookFinalization.sharePasscodeHint': null,
        'storybookFinalization.lastOrderId': null,
        'storybookFinalization.lockedAt': null,
        'storybookFinalization.lockedBy': null,
        'storybookFinalization.lockedByEmail': null,
        'storybookFinalization.lockedByDisplayName': null,
        'storybookFinalization.printableStatus': 'idle',
        'storybookFinalization.printablePdfUrl': null,
        'storybookFinalization.printableGeneratedAt': null,
        ...(regressionTag
          ? {
              regressionTest: true,
              regressionTag,
              'storybookFinalization.regressionTag': regressionTag,
            }
          : {}),
      });
      if (bookData.storySessionId) {
        await logSessionEvent(firestore, bookData.storySessionId, 'storybook.unlocked', {
          bookId,
          version: bookData?.storybookFinalization?.version ?? 0,
        });
      }
      return NextResponse.json({ ok: true, action: 'unlock', bookId });
    }

    // finalize
    const pages = await loadPages(firestore, bookId);
    if (pages.length === 0) {
      return respondError(400, 'No pages available to finalize.');
    }
    const pendingPage = pages.find((page: any) => page?.imageStatus !== 'ready');
    if (pendingPage) {
      return respondError(409, 'All pages must have ready artwork before finalizing.');
    }
    const version = Number(bookData?.storybookFinalization?.version ?? 0) + 1;
    let childName = bookData?.childDisplayName ?? bookData?.metadata?.childName ?? null;
    if (!childName && bookData?.childId) {
      try {
        const childSnap = await firestore.collection('children').doc(bookData.childId).get();
        if (childSnap.exists) {
          childName = childSnap.data()?.displayName ?? null;
        }
      } catch (childError) {
        console.warn('[storybook/finalize] Failed to load child profile', childError);
      }
    }
    const finalizedPages = pages.map((page: any) => ({
      pageNumber: page.pageNumber,
      kind: page.kind,
      title: page.title ?? null,
      bodyText: page.bodyText ?? null,
      imageUrl: page.imageUrl ?? null,
      imagePrompt: page.imagePrompt ?? null,
      layoutHints: page.layoutHints ?? null,
    }));
    const finalizationUpdate: Record<string, unknown> = {
      isLocked: true,
      finalizedSnapshotAt: FieldValue.serverTimestamp(),
      finalizedPages,
      finalizedMetadata: {
        bookTitle: bookData?.metadata?.title ?? bookData?.storyTitle ?? 'Storybook',
        childName,
        pageCount: finalizedPages.length,
        capturedAt: FieldValue.serverTimestamp(),
        version,
        storySessionId: bookData?.storySessionId ?? null,
        lockedByUid: user.uid,
        lockedByDisplayName: user.claims.name ?? null,
      },
      storybookFinalization: {
        ...(bookData.storybookFinalization ?? {}),
        version,
        status: 'finalized',
        lockedAt: FieldValue.serverTimestamp(),
        lockedBy: user.uid,
        lockedByEmail: user.email ?? null,
        lockedByDisplayName: user.claims.name ?? null,
        printablePdfUrl: null,
        printableStoragePath: null,
        printableGeneratedAt: null,
        printableStatus: 'idle',
        printableMetadata: null,
        printableErrorMessage: null,
        shareId: null,
        shareLink: null,
        shareExpiresAt: null,
        shareRequiresPasscode: false,
        sharePasscodeHint: null,
        lastOrderId: null,
        regressionTag: regressionTag ?? bookData?.storybookFinalization?.regressionTag ?? null,
      },
      ...(regressionTag
        ? {
            regressionTest: true,
            regressionTag,
          }
        : {}),
    };
    await bookSnap.ref.update(finalizationUpdate);
    if (bookData.storySessionId) {
      await logSessionEvent(firestore, bookData.storySessionId, 'storybook.finalized', {
        bookId,
        version,
        pageCount: finalizedPages.length,
      });
    }
    return NextResponse.json({
      ok: true,
      action: 'finalize',
      bookId,
      version,
      finalizedPageCount: finalizedPages.length,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[storybook/finalize] error', error);
    return respondError(500, error?.message ?? 'Unexpected finalize error');
  }
}
