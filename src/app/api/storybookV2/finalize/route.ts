'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';

type FinalizeRequest = {
  storyId: string;
  storybookId: string;
  action?: 'finalize' | 'unlock';
};

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
    console.warn('[storybookV2/finalize] Failed to log session event', error);
  }
}

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as FinalizeRequest;
    const { storyId, storybookId, action = 'finalize' } = body;

    if (!storyId) {
      return respondError(400, 'Missing storyId');
    }
    if (!storybookId) {
      return respondError(400, 'Missing storybookId');
    }
    if (!['finalize', 'unlock'].includes(action)) {
      return respondError(400, `Unsupported action "${action}"`);
    }

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();

    // Get story document
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return respondError(404, `Story not found at stories/${storyId}`);
    }
    const storyData = storySnap.data() as Record<string, any>;

    // Get storybook document (new model)
    const storybookRef = storyRef.collection('storybooks').doc(storybookId);
    const storybookSnap = await storybookRef.get();
    if (!storybookSnap.exists) {
      return respondError(404, `Storybook not found at stories/${storyId}/storybooks/${storybookId}`);
    }
    const storybookData = storybookSnap.data() as Record<string, any>;

    // Check ownership
    const parentUid = storyData.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this story.');
    }

    const finalization = storybookData.finalization ?? {};

    if (action === 'unlock') {
      const unlockUpdate = {
        isLocked: false,
        'finalization.status': 'draft',
        'finalization.unlockedAt': FieldValue.serverTimestamp(),
        'finalization.printableStatus': 'idle',
        'finalization.printablePdfUrl': FieldValue.delete(),
        'finalization.printableGeneratedAt': FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await storybookRef.update(unlockUpdate);

      if (storyData.storySessionId) {
        await logSessionEvent(firestore, storyData.storySessionId, 'storybook.unlocked', {
          storyId,
          storybookId,
          version: finalization?.version ?? 0,
        });
      }
      return NextResponse.json({ ok: true, action: 'unlock', storyId, storybookId });
    }

    // finalize action
    // Check that all pages have ready images
    const pagesSnap = await storybookRef.collection('pages').get();
    if (pagesSnap.empty) {
      return respondError(400, 'No pages available to finalize.');
    }

    const pages = pagesSnap.docs.map(doc => doc.data());
    const pendingPage = pages.find((page: any) => {
      // Pages without imagePrompt (title_page, blank) don't need images
      if (!page.imagePrompt) return false;
      return page.imageStatus !== 'ready';
    });

    if (pendingPage) {
      return respondError(409, 'All pages with illustrations must have ready artwork before finalizing.');
    }

    const version = Number(finalization?.version ?? 0) + 1;

    const finalizationUpdate = {
      isLocked: true,
      finalization: {
        ...finalization,
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
      },
      updatedAt: FieldValue.serverTimestamp(),
    };
    await storybookRef.update(finalizationUpdate);

    if (storyData.storySessionId) {
      await logSessionEvent(firestore, storyData.storySessionId, 'storybook.finalized', {
        storyId,
        storybookId,
        version,
        pageCount: pages.length,
      });
    }

    return NextResponse.json({
      ok: true,
      action: 'finalize',
      storyId,
      storybookId,
      version,
      finalizedPageCount: pages.length,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[storybookV2/finalize] error', error);
    return respondError(500, error?.message ?? 'Unexpected finalize error');
  }
}
