'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { randomBytes, createHash } from 'node:crypto';

type ShareActionRequest = {
  bookId: string;
  action?: 'create' | 'revoke';
  expiresInDays?: number;
  protectWithCode?: boolean;
  passcode?: string | null;
  regressionTag?: string;
};

type ShareViewResponse = {
  ok: true;
  bookId: string;
  shareId: string;
  finalizationVersion: number;
  metadata: Record<string, unknown> | null;
  pages: Array<Record<string, unknown>>;
  share: {
    expiresAt?: string | null;
    requiresPasscode: boolean;
    passcodeHint?: string | null;
  };
};

function randomShareId() {
  return randomBytes(4).toString('hex');
}

function ensurePasscode(passcode?: string | null) {
  if (passcode && passcode.length >= 4) {
    return passcode;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashSecret(secret: string, salt: string) {
  return createHash('sha256').update(`${secret}:${salt}`).digest('hex');
}

async function revokeExistingShare(firestore: FirebaseFirestore.Firestore, bookId: string, shareId?: string | null) {
  if (!shareId) return;
  await firestore
    .collection('stories')
    .doc(bookId)
    .collection('shareTokens')
    .doc(shareId)
    .set(
      {
        status: 'revoked',
        revokedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

function respondError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, errorMessage: message, ...(extra ?? {}) }, { status });
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const body = (await request.json()) as ShareActionRequest;
    const {
      bookId,
      action = 'create',
      expiresInDays = 14,
      protectWithCode = false,
      passcode: providedPasscode,
      regressionTag,
    } = body;
    if (!bookId) {
      return respondError(400, 'Missing bookId');
    }
    if (!['create', 'revoke'].includes(action)) {
      return respondError(400, `Unsupported action "${action}"`);
    }

    const user = await requireParentOrAdminUser(request);
    const firestore = getFirestore();
    const bookRef = firestore.collection('stories').doc(bookId);
    const bookSnap = await bookRef.get();
    if (!bookSnap.exists) {
      return respondError(404, 'Storybook not found');
    }
    const bookData = bookSnap.data() as Record<string, any>;
    const parentUid = bookData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this storybook.');
    }
    const currentShareId = bookData?.storybookFinalization?.shareId ?? null;

    if (action === 'revoke') {
      await revokeExistingShare(firestore, bookId, currentShareId ?? undefined);
      await bookRef.update({
        'storybookFinalization.shareId': null,
        'storybookFinalization.shareLink': null,
        'storybookFinalization.shareExpiresAt': null,
        'storybookFinalization.shareRequiresPasscode': false,
        'storybookFinalization.sharePasscodeHint': null,
      });
      return NextResponse.json({ ok: true, action: 'revoke', bookId });
    }

    const finalization = bookData?.storybookFinalization ?? null;
    if (!bookData?.isLocked || !finalization || finalization.status === 'draft') {
      return respondError(409, 'Finalize the storybook before creating a share link.');
    }

    const shareId = randomShareId();
    const expiresInDaysClamped = Math.min(Math.max(expiresInDays, 1), 90);
    const expiresDate = new Date(Date.now() + expiresInDaysClamped * 24 * 60 * 60 * 1000);
    const requiresPasscode = !!protectWithCode;
    const passcode = requiresPasscode ? ensurePasscode(providedPasscode) : null;
    const salt = requiresPasscode ? randomBytes(8).toString('hex') : null;
    const tokenHash = requiresPasscode && passcode && salt ? hashSecret(passcode, salt) : null;
    const shareDoc = {
      id: shareId,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: user.uid,
      expiresAt: expiresDate,
      requiresPasscode,
      finalizationVersion: finalization.version ?? 1,
      tokenHash,
      tokenSalt: salt,
      passcodeHint: passcode ? passcode.slice(-2) : null,
      regressionTag: regressionTag ?? finalization.regressionTag ?? null,
      viewCount: 0,
    };

    await revokeExistingShare(firestore, bookId, currentShareId ?? undefined);
    await bookRef.collection('shareTokens').doc(shareId).set(shareDoc);
    const shareLink = `/storybook/share/${shareId}`;
    await bookRef.update({
      'storybookFinalization.shareId': shareId,
      'storybookFinalization.shareLink': shareLink,
      'storybookFinalization.shareExpiresAt': expiresDate,
      'storybookFinalization.shareRequiresPasscode': requiresPasscode,
      'storybookFinalization.sharePasscodeHint': shareDoc.passcodeHint,
      'storybookFinalization.shareLastGeneratedAt': FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      action: 'create',
      bookId,
      shareId,
      shareLink,
      requiresPasscode,
      passcode,
      expiresAt: expiresDate.toISOString(),
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[storybook/share] error', error);
    return respondError(500, error?.message ?? 'Unexpected share error');
  }
}

export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    const url = new URL(request.url);
    const shareId = url.searchParams.get('shareId');
    const token = url.searchParams.get('token');
    if (!shareId) {
      return respondError(400, 'Missing shareId');
    }

    const firestore = getFirestore();
    const booksSnap = await firestore
      .collection('stories')
      .where('storybookFinalization.shareId', '==', shareId)
      .limit(1)
      .get();
    if (booksSnap.empty) {
      return respondError(404, 'Share link not found');
    }
    const docSnap = booksSnap.docs[0];
    const bookData = docSnap.data() as Record<string, any>;
    const finalization = bookData?.storybookFinalization ?? null;
    const shareRef = docSnap.ref.collection('shareTokens').doc(shareId);
    const shareSnap = await shareRef.get();
    if (!shareSnap.exists) {
      return respondError(404, 'Share token missing');
    }
    const shareData = shareSnap.data() as Record<string, any>;
    if (shareData.status !== 'active') {
      return respondError(410, 'This share link is no longer active');
    }
    const expiresAt = shareData?.expiresAt?.toDate?.();
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      await shareRef.update({
        status: 'expired',
        revokedAt: FieldValue.serverTimestamp(),
      });
      return respondError(410, 'This share link has expired');
    }
    if (shareData.requiresPasscode) {
      if (!token) {
        return respondError(401, 'Passcode required', {
          requiresToken: true,
          passcodeHint: shareData.passcodeHint ?? null,
        });
      }
      const salt = shareData.tokenSalt as string;
      const expectedHash = shareData.tokenHash as string;
      if (!salt || !expectedHash || hashSecret(token, salt) !== expectedHash) {
        return respondError(401, 'Invalid passcode', { requiresToken: true });
      }
    }
    if (!Array.isArray(bookData?.finalizedPages)) {
      return respondError(409, 'This storybook has not been finalized yet.');
    }

    await shareRef.update({
      viewCount: FieldValue.increment(1),
      lastViewedAt: FieldValue.serverTimestamp(),
    });

    const response: ShareViewResponse = {
      ok: true,
      bookId: docSnap.id,
      shareId,
      finalizationVersion: finalization?.version ?? 1,
      metadata: bookData?.finalizedMetadata ?? null,
      pages: bookData.finalizedPages ?? [],
      share: {
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        requiresPasscode: !!shareData.requiresPasscode,
        passcodeHint: shareData.passcodeHint ?? null,
      },
    };
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[storybook/share:get] error', error);
    return respondError(500, error?.message ?? 'Unexpected share view error');
  }
}
