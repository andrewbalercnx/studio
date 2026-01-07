import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { imageDescriptionFlow } from '@/ai/flows/image-description-flow';

type RegenerateImageDescriptionRequest = {
  entityId: string;
  entityType: 'child' | 'character';
};

function respondError(status: number, message: string) {
  return NextResponse.json({ ok: false, errorMessage: message }, { status });
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);
    const body = (await request.json()) as RegenerateImageDescriptionRequest;
    const { entityId, entityType } = body ?? {};

    if (!entityId || typeof entityId !== 'string') {
      return respondError(400, 'Missing entityId');
    }
    if (!entityType || !['child', 'character'].includes(entityType)) {
      return respondError(400, 'Invalid entityType - must be "child" or "character"');
    }

    const firestore = getFirestore();
    const collectionName = entityType === 'child' ? 'children' : 'characters';
    const entityRef = firestore.collection(collectionName).doc(entityId);
    const entitySnap = await entityRef.get();

    if (!entitySnap.exists) {
      return respondError(404, `${entityType} not found`);
    }

    const entityData = entitySnap.data() as Record<string, any>;
    const ownerParentUid = entityData?.ownerParentUid;

    if (!ownerParentUid) {
      return respondError(409, `${entityType} record is missing ownerParentUid`);
    }

    // Check ownership - parents can only regenerate for their own entities
    const isPrivileged = user.claims.isAdmin || user.claims.isWriter;
    if (!isPrivileged && ownerParentUid !== user.uid) {
      return respondError(403, `You do not own this ${entityType}`);
    }

    // Set status to pending before triggering
    await entityRef.update({
      'imageDescriptionGeneration.status': 'pending',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Trigger image description generation in background
    imageDescriptionFlow({ entityId, entityType }).catch((err) => {
      console.error(`[api/regenerate-image-description] Background generation failed for ${entityType} ${entityId}:`, err);
    });

    return NextResponse.json({
      ok: true,
      status: 'pending',
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return respondError(error.status, error.message);
    }
    console.error('[api/regenerate-image-description] error', error);
    return respondError(500, 'Failed to regenerate image description');
  }
}
