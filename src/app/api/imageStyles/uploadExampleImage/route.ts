import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getStoryBucket } from '@/firebase/admin/storage';
import type { ImageStyleExampleImage } from '@/lib/types';

type UploadExampleImageRequest = {
  imageStyleId: string;
  dataUrl?: string;     // Base64 data URL for direct upload
  sourceUrl?: string;   // URL to fetch and upload
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB cap
const MAX_EXAMPLE_IMAGES = 5;

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

async function fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'StoryPic-ImageFetcher/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new Error('URL does not point to an image');
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: contentType.split(';')[0], // Remove charset if present
  };
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    // Only admins can upload example images
    if (!user.claims.isAdmin) {
      return respondError(403, 'Admin access required');
    }

    const body = (await request.json()) as UploadExampleImageRequest;
    const { imageStyleId, dataUrl, sourceUrl } = body ?? {};

    if (!imageStyleId || typeof imageStyleId !== 'string') {
      return respondError(400, 'Missing imageStyleId');
    }
    if (!dataUrl && !sourceUrl) {
      return respondError(400, 'Either dataUrl or sourceUrl is required');
    }

    const firestore = getFirestore();
    const styleRef = firestore.collection('imageStyles').doc(imageStyleId);
    const styleSnap = await styleRef.get();
    if (!styleSnap.exists) {
      return respondError(404, 'Image style not found');
    }

    const styleData = styleSnap.data();
    const existingImages = (styleData?.exampleImages ?? []) as ImageStyleExampleImage[];
    if (existingImages.length >= MAX_EXAMPLE_IMAGES) {
      return respondError(400, `Maximum of ${MAX_EXAMPLE_IMAGES} example images allowed`);
    }

    // Get the image buffer and mime type
    let buffer: Buffer;
    let mimeType: string;

    if (dataUrl) {
      const parsed = parseDataUrl(dataUrl.trim());
      buffer = parsed.buffer;
      mimeType = parsed.mimeType;
    } else if (sourceUrl) {
      const fetched = await fetchImageFromUrl(sourceUrl);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType;
    } else {
      return respondError(400, 'No image data provided');
    }

    if (!mimeType?.startsWith('image/')) {
      return respondError(400, 'Only image uploads are supported');
    }
    if (buffer.length === 0) {
      return respondError(400, 'Image payload is empty');
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return respondError(413, 'Image exceeds maximum size (8MB)', { maxBytes: MAX_UPLOAD_BYTES });
    }

    const imageId = randomUUID();
    const extension = extensionFromMime(mimeType);
    const storagePath = `imageStyles/${imageStyleId}/examples/${imageId}.${extension}`;
    const downloadToken = randomUUID();

    const bucket = await getStoryBucket();
    await bucket.file(storagePath).save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        cacheControl: 'public,max-age=31536000', // 1 year cache for static assets
        metadata: {
          imageStyleId,
          exampleImageId: imageId,
          uploadedBy: user.uid,
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
      storagePath,
    )}?alt=media&token=${downloadToken}`;

    const newExampleImage: ImageStyleExampleImage = {
      id: imageId,
      url: downloadUrl,
      storagePath,
      uploadedAt: new Date(),
    };

    // Add to exampleImages array
    await styleRef.update({
      exampleImages: FieldValue.arrayUnion(newExampleImage),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      exampleImage: newExampleImage,
      totalImages: existingImages.length + 1,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    if (error instanceof Error && error.message === 'INVALID_DATA_URL') {
      return respondError(400, 'Invalid data URL payload');
    }
    if (error instanceof Error && error.message.includes('Failed to fetch')) {
      return respondError(400, error.message);
    }
    if (error instanceof Error && error.message.includes('URL does not point')) {
      return respondError(400, error.message);
    }
    console.error('[api/imageStyles/uploadExampleImage] upload error', error);
    return respondError(500, 'Failed to upload image');
  }
}
