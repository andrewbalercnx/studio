import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getStoryBucket } from '@/firebase/admin/storage';

type UploadImageRequest = {
  storyOutputTypeId: string;
  dataUrl: string;
  fileName?: string;
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB cap

function respondError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, errorMessage: message, ...(extra ?? {}) }, { status });
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('INVALID_DATA_URL');
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'img';
}

function sanitizeFileName(fileName: string | undefined, mimeType: string) {
  const fallbackExt = extensionFromMime(mimeType);
  const fallback = `image.${fallbackExt}`;
  if (!fileName) {
    return fallback;
  }
  const base = fileName.split('/').pop() ?? fileName;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  if (!cleaned) {
    return fallback;
  }
  if (!cleaned.includes('.') && fallbackExt) {
    return `${cleaned}.${fallbackExt}`;
  }
  return cleaned;
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    // Only admins can upload storyOutputType images
    if (!user.claims.isAdmin) {
      return respondError(403, 'Admin access required');
    }

    const body = (await request.json()) as UploadImageRequest;
    const { storyOutputTypeId, dataUrl, fileName } = body ?? {};

    if (!storyOutputTypeId || typeof storyOutputTypeId !== 'string') {
      return respondError(400, 'Missing storyOutputTypeId');
    }
    if (!dataUrl || typeof dataUrl !== 'string') {
      return respondError(400, 'Missing dataUrl');
    }

    const { buffer, mimeType } = parseDataUrl(dataUrl.trim());
    if (!mimeType?.startsWith('image/')) {
      return respondError(400, 'Only image uploads are supported');
    }
    if (buffer.length === 0) {
      return respondError(400, 'Image payload is empty');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return respondError(413, 'Image exceeds maximum size (8MB)', { maxBytes: MAX_UPLOAD_BYTES });
    }

    const firestore = getFirestore();
    const outputTypeRef = firestore.collection('storyOutputTypes').doc(storyOutputTypeId);
    const outputTypeSnap = await outputTypeRef.get();
    if (!outputTypeSnap.exists) {
      return respondError(404, 'Story output type not found');
    }

    const safeName = sanitizeFileName(fileName, mimeType);
    const objectPath = `storyOutputTypes/${storyOutputTypeId}/${Date.now()}_${safeName}`;
    const downloadToken = randomUUID();

    const bucket = await getStoryBucket();
    await bucket.file(objectPath).save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        cacheControl: 'public,max-age=31536000', // 1 year cache for static assets
        metadata: {
          storyOutputTypeId,
          uploadedBy: user.uid,
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      objectPath,
    )}?alt=media&token=${downloadToken}`;

    // Update the storyOutputType document with the new imageUrl
    await outputTypeRef.update({
      imageUrl: downloadUrl,
      updatedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      imageUrl: downloadUrl,
      objectPath,
      contentType: mimeType,
      size: buffer.length,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    if (error instanceof Error && error.message === 'INVALID_DATA_URL') {
      return respondError(400, 'Invalid data URL payload');
    }
    console.error('[api/storyOutputTypes/uploadImage] upload error', error);
    return respondError(500, 'Failed to upload image');
  }
}
