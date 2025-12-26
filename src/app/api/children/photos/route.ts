import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {requireParentOrAdminUser} from '@/lib/server-auth';
import {AuthError} from '@/lib/auth-error';
import {getStoryBucket} from '@/firebase/admin/storage';
import {initFirebaseAdminApp} from '@/firebase/admin/app';

type UploadPhotoRequest = {
  childId: string;
  dataUrl: string;
  fileName?: string;
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB cap for browser uploads

function respondError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ok: false, errorMessage: message, ...(extra ?? {})}, {status});
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
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  if (mimeType === 'image/gif') return 'gif';
  return 'img';
}

function sanitizeFileName(fileName: string | undefined, mimeType: string) {
  const fallbackExt = extensionFromMime(mimeType);
  const fallback = `photo.${fallbackExt}`;
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
    const body = (await request.json()) as UploadPhotoRequest;
    const {childId, dataUrl, fileName} = body ?? {};
    if (!childId || typeof childId !== 'string') {
      return respondError(400, 'Missing childId');
    }
    if (!dataUrl || typeof dataUrl !== 'string') {
      return respondError(400, 'Missing dataUrl');
    }

    const {buffer, mimeType} = parseDataUrl(dataUrl.trim());
    if (!mimeType?.startsWith('image/')) {
      return respondError(400, 'Only image uploads are supported');
    }
    if (buffer.length === 0) {
      return respondError(400, 'Image payload is empty');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return respondError(413, 'Image exceeds maximum size', {maxBytes: MAX_UPLOAD_BYTES});
    }

    const firestore = getFirestore();
    const childRef = firestore.collection('children').doc(childId);
    const childSnap = await childRef.get();
    if (!childSnap.exists) {
      return respondError(404, 'Child not found');
    }
    const childData = childSnap.data() as Record<string, any>;
    const ownerParentUid = childData?.ownerParentUid;
    if (!ownerParentUid) {
      return respondError(409, 'Child record is missing ownerParentUid');
    }
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && ownerParentUid !== user.uid) {
      return respondError(403, 'You do not own this child profile');
    }

    const safeName = sanitizeFileName(fileName, mimeType);
    const objectPath = `users/${ownerParentUid}/children/${childId}/photos/${Date.now()}_${safeName}`;
    const downloadToken = randomUUID();

    const bucket = await getStoryBucket();
    await bucket.file(objectPath).save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        cacheControl: 'public,max-age=3600',
        metadata: {
          ownerParentUid,
          childId,
          uploadedBy: user.uid,
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      objectPath,
    )}?alt=media&token=${downloadToken}`;

    return NextResponse.json({
      ok: true,
      downloadUrl,
      objectPath,
      contentType: mimeType,
      size: buffer.length,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    if (error?.message === 'INVALID_DATA_URL') {
      return respondError(400, 'Invalid data URL payload');
    }
    console.error('[api/children/photos] upload error', error);
    return respondError(500, 'Failed to upload child photo');
  }
}
