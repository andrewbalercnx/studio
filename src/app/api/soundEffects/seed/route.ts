import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { ANSWER_ANIMATION_PRESETS } from '@/lib/animation-presets';

/**
 * POST /api/soundEffects/seed
 *
 * Seeds the answerAnimations collection with default animation configurations.
 * Admin or writer access required.
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin && !user.claims.isWriter) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin or writer access required' },
        { status: 403 }
      );
    }

    const firestore = getFirestore();
    const batch = firestore.batch();
    const results: { id: string; action: 'created' | 'updated' }[] = [];

    for (const animation of ANSWER_ANIMATION_PRESETS) {
      const docRef = firestore.collection('answerAnimations').doc(animation.id);
      const existingDoc = await docRef.get();

      if (existingDoc.exists) {
        // Update existing document, but preserve sound effect audio URLs if already generated
        const existingData = existingDoc.data();
        const existingSoundEffect = existingData?.soundEffect;

        batch.set(docRef, {
          ...animation,
          // Preserve generated audio if it exists and is ready
          soundEffect: {
            ...animation.soundEffect,
            // Keep existing audio URL if sound has been generated
            ...(existingSoundEffect?.audioUrl && {
              audioUrl: existingSoundEffect.audioUrl,
              storagePath: existingSoundEffect.storagePath,
              generation: existingSoundEffect.generation,
            }),
          },
          createdAt: existingData?.createdAt || FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        results.push({ id: animation.id, action: 'updated' });
      } else {
        // Create new document
        batch.set(docRef, {
          ...animation,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        results.push({ id: animation.id, action: 'created' });
      }
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: `Seeded ${results.length} answer animations`,
      results,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Unexpected error';
    console.error('[soundEffects/seed] Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage },
      { status: 500 }
    );
  }
}
