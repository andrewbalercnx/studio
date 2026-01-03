import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { randomUUID } from 'crypto';

type MusicGenerateRequest = {
  generatorId: string;
  prompt?: string;       // Override prompt (optional)
  durationMs?: number;   // 30000-60000 (default: 45000)
};

/**
 * POST /api/music/generate-generator
 *
 * Generate background music for a story generator using ElevenLabs Music API.
 * The generated music is uploaded to Firebase Storage and the URL is stored
 * on the generator document.
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

    const body = await request.json() as MusicGenerateRequest;
    const { generatorId, prompt: overridePrompt, durationMs = 45000 } = body;

    if (!generatorId) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing generatorId' },
        { status: 400 }
      );
    }

    // Validate duration is within allowed range (30-60 seconds)
    const validDuration = Math.min(Math.max(durationMs, 30000), 60000);

    const firestore = getFirestore();
    const generatorRef = firestore.collection('storyGenerators').doc(generatorId);
    const generatorDoc = await generatorRef.get();

    if (!generatorDoc.exists) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Story generator not found' },
        { status: 404 }
      );
    }

    const generator = generatorDoc.data();
    const musicPrompt = overridePrompt || generator?.backgroundMusic?.prompt;

    if (!musicPrompt) {
      return NextResponse.json(
        { ok: false, errorMessage: 'No music prompt provided. Please set a music prompt first.' },
        { status: 400 }
      );
    }

    // Update status to 'generating'
    await generatorRef.update({
      'backgroundMusic.generation.status': 'generating',
      'backgroundMusic.generation.lastRunAt': FieldValue.serverTimestamp(),
      'backgroundMusic.generation.lastErrorMessage': null,
      'backgroundMusic.prompt': musicPrompt,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[api/music/generate-generator] Generating music for generator: ${generatorId}, duration: ${validDuration}ms`);

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[api/music/generate-generator] ELEVENLABS_API_KEY environment variable not set');
      await generatorRef.update({
        'backgroundMusic.generation.status': 'error',
        'backgroundMusic.generation.lastErrorMessage': 'Music service is not configured',
      });
      return NextResponse.json(
        { ok: false, errorMessage: 'Music service is not configured. Please contact support.' },
        { status: 503 }
      );
    }

    try {
      // Call ElevenLabs Music API
      const response = await fetch('https://api.elevenlabs.io/v1/music', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          prompt: musicPrompt,
          music_length_ms: validDuration,
          force_instrumental: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[api/music/generate-generator] ElevenLabs API error: ${response.status} - ${errorText}`);
        throw new Error(`Music generation failed: ${response.status}`);
      }

      // Get audio buffer from response
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      console.log(`[api/music/generate-generator] Received audio: ${audioBuffer.byteLength} bytes`);

      // Upload to Firebase Storage
      const bucket = await getStoryBucket();
      const downloadToken = randomUUID();
      const storagePath = `story-generators/${generatorId}/background-music.mp3`;

      await bucket.file(storagePath).save(audioBuffer, {
        contentType: 'audio/mpeg',
        resumable: false,
        metadata: {
          cacheControl: 'public,max-age=31536000', // Cache for 1 year (music doesn't change often)
          metadata: {
            generatorId,
            durationMs: String(validDuration),
            generatedBy: user.uid,
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });

      // Generate download URL
      const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

      console.log(`[api/music/generate-generator] Uploaded music to: ${storagePath}`);

      // Update generator with success
      await generatorRef.update({
        'backgroundMusic.audioUrl': audioUrl,
        'backgroundMusic.storagePath': storagePath,
        'backgroundMusic.durationMs': validDuration,
        'backgroundMusic.generation.status': 'ready',
        'backgroundMusic.generation.lastCompletedAt': FieldValue.serverTimestamp(),
        'backgroundMusic.generation.lastErrorMessage': null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        ok: true,
        audioUrl,
        durationMs: validDuration,
      });

    } catch (error: any) {
      console.error('[api/music/generate-generator] Generation error:', error);

      // Update status to error
      await generatorRef.update({
        'backgroundMusic.generation.status': 'error',
        'backgroundMusic.generation.lastErrorMessage': error.message || 'Unknown error',
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json(
        { ok: false, errorMessage: error.message || 'Failed to generate music' },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('[api/music/generate-generator] Route error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: `API /music/generate-generator route error: ${error.message}` },
      { status: 500 }
    );
  }
}
