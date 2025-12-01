
'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';

type FinalizeRequest = {
  storyId: string;
  outputId: string;
  action?: 'finalize' | 'unlock';
  regressionTag?: string;
};

type StoryOutputDoc = FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>;

async function getDocs(
  firestore: Firestore,
  storyId: string,
  outputId: string
): Promise<{ storySnap: StoryOutputDoc; outputSnap: StoryOutputDoc }> {
  const storySnap = await firestore.collection('stories').doc(storyId).get();
  const outputSnap = await storySnap.ref.collection('outputs').doc(outputId).get();
  return { storySnap, outputSnap };
}

async function loadPages(
  firestore: Firestore,
  storyId: string,
  outputId: string
) {
  const pagesSnap = await firestore
    .collection('stories').doc(storyId).collection('outputs').doc(outputId)
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
  storyId: string,
  outputId: string,
  shareId?: string | null,
  uid?: string
) {
  if (!shareId) return;
  try {
    await firestore
      .collection('stories').doc(storyId).collection('outputs').doc(outputId)
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
    const { storyId, outputId, action = 'finalize', regressionTag } = body;
    if (!storyId || !outputId) {
      return respondError(400, 'Missing storyId or outputId');
    }
    if (!['finalize', 'unlock'].includes(action)) {
      return respondError(400, `Unsupported action "${action}"`);
    }

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const { storySnap, outputSnap } = await getDocs(firestore, storyId, outputId);
    if (!storySnap.exists) {
      return respondError(404, `stories/${storyId} not found`);
    }
    if (!outputSnap.exists) {
        return respondError(404, `stories/${storyId}/outputs/${outputId} not found`);
    }
    const storyData = (storySnap.data() as Record<string, any>) || {};
    const outputData = (outputSnap.data() as Record<string, any>) || {};
    const parentUid = storyData.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this story.');
    }

    const finalization = outputData.finalization ?? {};
    const regressionMeta = regressionTag ? { regressionTest: true, regressionTag } : {};

    if (action === 'unlock') {
      await revokeActiveShareToken(firestore, storyId, outputId, finalization?.shareId, user.uid);
      const unlockUpdate = {
        'finalization.status': 'draft',
        'finalization.unlockedAt': FieldValue.serverTimestamp(),
        'finalization.shareId': FieldValue.delete(),
        'finalization.shareLink': FieldValue.delete(),
        'finalization.shareExpiresAt': FieldValue.delete(),
        'finalization.shareRequiresPasscode': FieldValue.delete(),
        'finalization.sharePasscodeHint': FieldValue.delete(),
        'finalization.lastOrderId': FieldValue.delete(),
        'finalization.lockedAt': FieldValue.delete(),
        'finalization.lockedBy': FieldValue.delete(),
        'finalization.lockedByEmail': FieldValue.delete(),
        'finalization.lockedByDisplayName': FieldValue.delete(),
        'finalization.printableStatus': 'idle',
        'finalization.printablePdfUrl': FieldValue.delete(),
        'finalization.printableGeneratedAt': FieldValue.delete(),
        ...regressionMeta,
      };
      await outputSnap.ref.update(unlockUpdate);
      if (storyData.storySessionId) {
        await logSessionEvent(firestore, storyData.storySessionId, 'storybook.unlocked', {
          storyId,
          outputId,
          version: finalization?.version ?? 0,
        });
      }
      return NextResponse.json({ ok: true, action: 'unlock', storyId, outputId });
    }

    // finalize
    const pages = await loadPages(firestore, storyId, outputId);
    if (pages.length === 0) {
      return respondError(400, 'No pages available to finalize.');
    }
    const pendingPage = pages.find((page: any) => page?.imageStatus !== 'ready');
    if (pendingPage) {
      return respondError(409, 'All pages must have ready artwork before finalizing.');
    }
    const version = Number(finalization?.version ?? 0) + 1;
    
    const finalizationUpdate: Record<string, unknown> = {
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
        shareId: null,
        shareLink: null,
        shareExpiresAt: null,
        shareRequiresPasscode: false,
        sharePasscodeHint: null,
        lastOrderId: null,
        ...regressionMeta,
      },
      ...regressionMeta,
    };
    await outputSnap.ref.update(finalizationUpdate);
    if (storyData.storySessionId) {
      await logSessionEvent(firestore, storyData.storySessionId, 'storybook.finalized', {
        storyId,
        outputId,
        version,
        pageCount: pages.length,
      });
    }
    return NextResponse.json({
      ok: true,
      action: 'finalize',
      storyId,
      outputId,
      version,
      finalizedPageCount: pages.length,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[storybook/finalize] error', error);
    return respondError(500, error?.message ?? 'Unexpected finalize error');
  }
}
