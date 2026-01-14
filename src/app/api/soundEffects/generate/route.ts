import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { randomUUID } from 'crypto';
import type { AnswerAnimation } from '@/lib/types';

type SoundEffectGenerateRequest = {
  animationId: string;
  prompt?: string;           // Override prompt (optional)
  durationSeconds?: number;  // 0.5-30 (default from animation config)
  promptInfluence?: number;  // 0-1 (default: 0.3)
};

/**
 * POST /api/soundEffects/generate
 *
 * Generate a sound effect for an answer animation using ElevenLabs Text-to-Sound-Effects API.
 * The generated audio is uploaded to Firebase Storage and the URL is stored
 * on the animation document.
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    // Require admin or writer role
    if (!user.claims.isAdmin && !user.claims.isWriter) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin or writer access required' },
        { status: 403 }
      );
    }

    const body = await request.json() as SoundEffectGenerateRequest;
    const { animationId, prompt: overridePrompt, durationSeconds: overrideDuration, promptInfluence } = body;

    if (!animationId) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing animationId' },
        { status: 400 }
      );
    }

    const firestore = getFirestore();
    const animationRef = firestore.collection('answerAnimations').doc(animationId);
    const animationDoc = await animationRef.get();

    if (!animationDoc.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Animation not found' },
        { status: 404 }
      );
    }

    const animation = animationDoc.data() as AnswerAnimation;
    const sfxPrompt = overridePrompt || animation.soundEffect?.prompt;

    if (!sfxPrompt) {
      return NextResponse.json(
        { ok: false, errorMessage: 'No sound effect prompt provided. Please set a prompt first.' },
        { status: 400 }
      );
    }

    // Validate duration is within allowed range (0.5-30 seconds)
    const rawDuration = overrideDuration ?? animation.soundEffect?.durationSeconds ?? 0.5;
    const validDuration = Math.min(Math.max(rawDuration, 0.5), 30);

    // Validate promptInfluence is within allowed range (0-1)
    const rawInfluence = promptInfluence ?? animation.soundEffect?.promptInfluence ?? 0.3;
    const validInfluence = Math.min(Math.max(rawInfluence, 0), 1);

    // Update status to 'generating'
    await animationRef.update({
      'soundEffect.prompt': sfxPrompt,
      'soundEffect.durationSeconds': validDuration,
      'soundEffect.promptInfluence': validInfluence,
      'soundEffect.generation.status': 'generating',
      'soundEffect.generation.lastRunAt': FieldValue.serverTimestamp(),
      'soundEffect.generation.lastErrorMessage': null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[api/soundEffects/generate] Generating sound effect for animation: ${animationId}, duration: ${validDuration}s`);

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[api/soundEffects/generate] ELEVENLABS_API_KEY environment variable not set');
      await animationRef.update({
        'soundEffect.generation.status': 'error',
        'soundEffect.generation.lastErrorMessage': 'Sound effects service is not configured',
      });
      return NextResponse.json(
        { ok: false, errorMessage: 'Sound effects service is not configured. Please contact support.' },
        { status: 503 }
      );
    }

    try {
      // Call ElevenLabs Text-to-Sound-Effects API
      const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: sfxPrompt,
          duration_seconds: validDuration,
          prompt_influence: validInfluence,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[api/soundEffects/generate] ElevenLabs API error: ${response.status} - ${errorText}`);
        throw new Error(`Sound effect generation failed: ${response.status}`);
      }

      // Get audio buffer from response
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      console.log(`[api/soundEffects/generate] Received audio: ${audioBuffer.byteLength} bytes`);

      // Upload to Firebase Storage
      const bucket = await getStoryBucket();
      const downloadToken = randomUUID();
      const storagePath = `animations/${animationId}/sound-effect.mp3`;

      await bucket.file(storagePath).save(audioBuffer, {
        contentType: 'audio/mpeg',
        resumable: false,
        metadata: {
          cacheControl: 'public,max-age=31536000', // Cache for 1 year
          metadata: {
            animationId,
            durationSeconds: String(validDuration),
            generatedBy: user.uid,
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });

      // Generate download URL
      const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

      console.log(`[api/soundEffects/generate] Uploaded sound effect to: ${storagePath}`);

      // Update animation with success
      await animationRef.update({
        'soundEffect.audioUrl': audioUrl,
        'soundEffect.storagePath': storagePath,
        'soundEffect.generation.status': 'ready',
        'soundEffect.generation.lastCompletedAt': FieldValue.serverTimestamp(),
        'soundEffect.generation.lastErrorMessage': null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        ok: true,
        audioUrl,
        durationSeconds: validDuration,
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[api/soundEffects/generate] Generation error:', error);

      // Update status to error
      await animationRef.update({
        'soundEffect.generation.status': 'error',
        'soundEffect.generation.lastErrorMessage': errorMessage,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json(
        { ok: false, errorMessage: errorMessage || 'Failed to generate sound effect' },
        { status: 500 }
      );
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[api/soundEffects/generate] Route error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: `API /soundEffects/generate route error: ${errorMessage}` },
      { status: 500 }
    );
  }
}
