'use server';

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { randomBytes, createHash } from 'node:crypto';
import { resolveEntitiesInText, replacePlaceholdersInText } from '@/lib/resolve-placeholders.server';

type ShareActionRequest = {
  bookId: string;
  storybookId?: string; // For new model: storyId is bookId, storybookId is the subcollection doc
  action?: 'create' | 'revoke';
  expiresInDays?: number;
  protectWithCode?: boolean;
  passcode?: string | null;
  regressionTag?: string;
};

type ShareViewResponse = {
  ok: true;
  storyId: string;
  storybookId?: string;
  bookId: string; // Deprecated: use storyId instead
  shareId: string;
  finalizationVersion: number;
  metadata: {
    bookTitle?: string;
    childName?: string;
  } | null;
  pages: Array<{
    pageNumber: number;
    kind: string;
    title?: string | null;
    bodyText?: string | null;
    displayText?: string | null;
    imageUrl?: string | null;
    audioUrl?: string | null;
  }>;
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
      storybookId,
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

    // Determine if this is the new model (storybookId provided) or legacy model
    const isNewModel = !!storybookId;
    const storyId = bookId; // In new model, bookId is actually storyId

    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return respondError(404, 'Story not found');
    }
    const storyData = storySnap.data() as Record<string, any>;
    const parentUid = storyData?.parentUid;
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && parentUid && parentUid !== user.uid) {
      return respondError(403, 'You do not own this storybook.');
    }

    // For new model, get the storybook document
    let storybookRef: FirebaseFirestore.DocumentReference | null = null;
    let storybookData: Record<string, any> | null = null;
    let finalization: Record<string, any> | null = null;
    let currentShareId: string | null = null;

    if (isNewModel) {
      storybookRef = storyRef.collection('storybooks').doc(storybookId);
      const storybookSnap = await storybookRef.get();
      if (!storybookSnap.exists) {
        return respondError(404, 'Storybook not found');
      }
      storybookData = storybookSnap.data() as Record<string, any>;
      finalization = storybookData?.finalization ?? null;
      currentShareId = finalization?.shareId ?? null;
    } else {
      // Legacy model
      finalization = storyData?.storybookFinalization ?? null;
      currentShareId = finalization?.shareId ?? null;
    }

    if (action === 'revoke') {
      await revokeExistingShare(firestore, storyId, currentShareId ?? undefined);

      if (isNewModel && storybookRef) {
        await storybookRef.update({
          'finalization.shareId': null,
          'finalization.shareLink': null,
          'finalization.shareExpiresAt': null,
          'finalization.shareRequiresPasscode': false,
          'finalization.sharePasscodeHint': null,
        });
      } else {
        await storyRef.update({
          'storybookFinalization.shareId': null,
          'storybookFinalization.shareLink': null,
          'storybookFinalization.shareExpiresAt': null,
          'storybookFinalization.shareRequiresPasscode': false,
          'storybookFinalization.sharePasscodeHint': null,
        });
      }
      return NextResponse.json({ ok: true, action: 'revoke', bookId: storyId, storybookId });
    }

    // Check finalization status
    const isLocked = isNewModel ? storybookData?.isLocked : storyData?.isLocked;
    if (!isLocked || !finalization || finalization.status === 'draft') {
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
      storyId,
      storybookId: storybookId ?? null,
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

    await revokeExistingShare(firestore, storyId, currentShareId ?? undefined);
    // Store share token in story's shareTokens subcollection (both models)
    await storyRef.collection('shareTokens').doc(shareId).set(shareDoc);

    // Also store a lookup document in shareLinks collection (avoids collectionGroup query)
    await firestore.collection('shareLinks').doc(shareId).set({
      storyId,
      storybookId: storybookId ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    const shareLink = `/storybook/share/${shareId}`;

    // Update the appropriate document with share info
    if (isNewModel && storybookRef) {
      await storybookRef.update({
        'finalization.shareId': shareId,
        'finalization.shareLink': shareLink,
        'finalization.shareExpiresAt': expiresDate,
        'finalization.shareRequiresPasscode': requiresPasscode,
        'finalization.sharePasscodeHint': shareDoc.passcodeHint,
        'finalization.shareLastGeneratedAt': FieldValue.serverTimestamp(),
      });
    } else {
      await storyRef.update({
        'storybookFinalization.shareId': shareId,
        'storybookFinalization.shareLink': shareLink,
        'storybookFinalization.shareExpiresAt': expiresDate,
        'storybookFinalization.shareRequiresPasscode': requiresPasscode,
        'storybookFinalization.sharePasscodeHint': shareDoc.passcodeHint,
        'storybookFinalization.shareLastGeneratedAt': FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({
      ok: true,
      action: 'create',
      bookId: storyId,
      storybookId,
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

    // Look up the share link to get storyId (avoids collectionGroup query which needs index)
    const shareLinkSnap = await firestore.collection('shareLinks').doc(shareId).get();
    if (!shareLinkSnap.exists) {
      return respondError(404, 'Share link not found');
    }
    const shareLinkData = shareLinkSnap.data() as Record<string, any>;
    const storyId = shareLinkData?.storyId;
    const storybookId = shareLinkData?.storybookId;
    const isNewModel = !!storybookId;

    if (!storyId) {
      return respondError(404, 'Share link not found - missing story reference');
    }

    // Now fetch the share token from the story's subcollection
    const shareSnap = await firestore
      .collection('stories')
      .doc(storyId)
      .collection('shareTokens')
      .doc(shareId)
      .get();

    if (!shareSnap.exists) {
      return respondError(404, 'Share link not found');
    }

    const shareData = shareSnap.data() as Record<string, any>;

    // Validate share token status and expiration
    if (shareData.status !== 'active') {
      return respondError(410, 'This share link is no longer active');
    }
    const expiresAt = shareData?.expiresAt?.toDate?.();
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      await shareSnap.ref.update({
        status: 'expired',
        revokedAt: FieldValue.serverTimestamp(),
      });
      return respondError(410, 'This share link has expired');
    }

    // Validate passcode if required
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

    // Fetch the story and storybook data
    const storyRef = firestore.collection('stories').doc(storyId);
    const storySnap = await storyRef.get();
    if (!storySnap.exists) {
      return respondError(404, 'Story not found');
    }
    const storyData = storySnap.data() as Record<string, any>;

    type PageData = {
      pageNumber: number;
      kind: string;
      title?: string | null;
      bodyText?: string | null;
      displayText?: string | null;
      imageUrl?: string | null;
      audioUrl?: string | null;
    };
    let pages: PageData[] = [];
    let metadata: { bookTitle?: string; childName?: string } | null = null;
    let finalizationVersion = 1;

    if (isNewModel) {
      // New model: fetch from storybook subcollection
      const storybookRef = storyRef.collection('storybooks').doc(storybookId);
      const storybookSnap = await storybookRef.get();
      if (!storybookSnap.exists) {
        return respondError(404, 'Storybook not found');
      }
      const storybookData = storybookSnap.data() as Record<string, any>;
      const finalization = storybookData?.finalization ?? {};
      finalizationVersion = finalization?.version ?? 1;

      // Verify the storybook is finalized
      if (!storybookData?.isLocked) {
        return respondError(409, 'This storybook has not been finalized yet.');
      }

      // Fetch pages from subcollection
      const pagesSnap = await storybookRef.collection('pages').orderBy('pageNumber', 'asc').get();
      pages = pagesSnap.docs.map((doc) => {
        const pageData = doc.data();
        return {
          pageNumber: pageData.pageNumber,
          kind: pageData.kind,
          title: pageData.title ?? null,
          bodyText: pageData.bodyText ?? null,
          displayText: pageData.displayText ?? null,
          imageUrl: pageData.imageUrl ?? null,
          audioUrl: pageData.audioUrl ?? null,
        };
      });

      metadata = {
        bookTitle: storybookData?.title || storyData?.metadata?.title || null,
        childName: storyData?.metadata?.childName || null,
      };
    } else {
      // Legacy model: use finalizedPages from story document
      if (!Array.isArray(storyData?.finalizedPages)) {
        return respondError(409, 'This storybook has not been finalized yet.');
      }
      const finalization = storyData?.storybookFinalization ?? {};
      finalizationVersion = finalization?.version ?? 1;
      pages = storyData.finalizedPages.map((page: Record<string, any>) => ({
        pageNumber: page.pageNumber as number,
        kind: page.kind as string,
        title: (page.title as string) ?? null,
        bodyText: (page.bodyText as string) ?? null,
        displayText: (page.displayText as string) ?? null,
        imageUrl: (page.imageUrl as string) ?? null,
        audioUrl: (page.audioUrl as string) ?? null,
      }));
      metadata = storyData?.finalizedMetadata ?? null;
    }

    // Resolve placeholders in page text if displayText is missing or contains $$placeholders$$
    // This ensures shared storybooks display resolved names, not placeholder IDs
    const hasUnresolvedPlaceholders = pages.some((p) => {
      const text = p.displayText || p.bodyText || '';
      return /\$\$[^$]+\$\$/.test(text) || /\$[a-zA-Z0-9_-]{15,}\$/.test(text);
    });

    if (hasUnresolvedPlaceholders) {
      // Collect all text that needs resolution
      const allText = pages.map((p) => p.displayText || p.bodyText || '').join(' ');
      const entityMap = await resolveEntitiesInText(allText);

      // Resolve each page's displayText
      pages = await Promise.all(
        pages.map(async (p) => {
          const textToResolve = p.displayText || p.bodyText || '';
          if (!textToResolve) return p;
          const resolved = await replacePlaceholdersInText(textToResolve, entityMap);
          return { ...p, displayText: resolved };
        })
      );
    }

    // Update view count
    await shareSnap.ref.update({
      viewCount: FieldValue.increment(1),
      lastViewedAt: FieldValue.serverTimestamp(),
    });

    const response: ShareViewResponse = {
      ok: true,
      storyId,
      storybookId,
      bookId: storyId, // Deprecated
      shareId,
      finalizationVersion,
      metadata,
      pages,
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
