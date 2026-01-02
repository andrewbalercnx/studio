import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getStoryBucket } from '@/firebase/admin/storage';
import type { ImageStyleExampleImage } from '@/lib/types';

type DeleteExampleImageRequest = {
  imageStyleId: string;
  exampleImageId: string;
};

function respondError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, errorMessage: message, ...(extra ?? {}) }, { status });
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    // Only admins can delete example images
    if (!user.claims.isAdmin) {
      return respondError(403, 'Admin access required');
    }

    const body = (await request.json()) as DeleteExampleImageRequest;
    const { imageStyleId, exampleImageId } = body ?? {};

    if (!imageStyleId || typeof imageStyleId !== 'string') {
      return respondError(400, 'Missing imageStyleId');
    }
    if (!exampleImageId || typeof exampleImageId !== 'string') {
      return respondError(400, 'Missing exampleImageId');
    }

    const firestore = getFirestore();
    const styleRef = firestore.collection('imageStyles').doc(imageStyleId);
    const styleSnap = await styleRef.get();
    if (!styleSnap.exists) {
      return respondError(404, 'Image style not found');
    }

    const styleData = styleSnap.data();
    const exampleImages = (styleData?.exampleImages ?? []) as ImageStyleExampleImage[];
    const imageToDelete = exampleImages.find((img) => img.id === exampleImageId);

    if (!imageToDelete) {
      return respondError(404, 'Example image not found');
    }

    // Delete from Storage
    try {
      const bucket = await getStoryBucket();
      await bucket.file(imageToDelete.storagePath).delete();
    } catch (storageError: unknown) {
      // Log but continue - file may already be deleted
      console.warn('[api/imageStyles/deleteExampleImage] Storage delete failed (may be already deleted):', storageError);
    }

    // Remove from Firestore array
    const updatedImages = exampleImages.filter((img) => img.id !== exampleImageId);
    await styleRef.update({
      exampleImages: updatedImages,
      updatedAt: new Date(),
    });

    return NextResponse.json({
      ok: true,
      deletedImageId: exampleImageId,
      remainingImages: updatedImages.length,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[api/imageStyles/deleteExampleImage] delete error', error);
    return respondError(500, 'Failed to delete image');
  }
}
