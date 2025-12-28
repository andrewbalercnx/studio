import { NextResponse } from 'next/server';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { ELEVENLABS_TTS_VOICES, ELEVENLABS_MODEL } from '@/lib/tts-config';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Sample text for voice preview - short and engaging
const PREVIEW_TEXT = "Once upon a time, in a magical forest filled with wonder, there lived a brave little adventurer who loved to explore.";

// Valid preset voice IDs from shared config
const VALID_PRESET_VOICE_IDS = ELEVENLABS_TTS_VOICES.map(v => v.id);

type PreviewRequest = {
  voiceName: string;
};

/**
 * Convert a readable stream to a buffer
 */
async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * API route for generating a voice preview sample.
 * Supports both preset ElevenLabs voices and parent cloned voices.
 * Returns base64-encoded audio data for immediate playback.
 */
export async function POST(request: Request) {
  try {
    const authUser = await requireParentOrAdminUser(request);

    const body = (await request.json()) as PreviewRequest;
    const { voiceName } = body;

    if (!voiceName || typeof voiceName !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing voiceName' },
        { status: 400 }
      );
    }

    // Check if it's a preset voice
    const isPresetVoice = VALID_PRESET_VOICE_IDS.includes(voiceName as any);

    // If not a preset voice, verify it's a parent's cloned voice
    if (!isPresetVoice) {
      await initFirebaseAdminApp();
      const firestore = getFirestore();

      const voiceDoc = await firestore
        .collection('users')
        .doc(authUser.uid)
        .collection('voices')
        .doc(voiceName)
        .get();

      if (!voiceDoc.exists) {
        return NextResponse.json(
          { ok: false, errorMessage: `Invalid voice: ${voiceName}` },
          { status: 400 }
        );
      }
    }

    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey: process.env.ELEVENLABS_API_KEY!,
    });

    // Generate audio preview with British English pronunciation
    const audioStream = await elevenlabs.textToSpeech.convert(voiceName, {
      text: PREVIEW_TEXT,
      modelId: ELEVENLABS_MODEL,
      languageCode: 'en-GB',
    });

    // Convert stream to buffer
    const audioBuffer = await streamToBuffer(audioStream as unknown as ReadableStream<Uint8Array>);

    // ElevenLabs returns MP3 by default
    const finalAudioData = audioBuffer.toString('base64');
    const finalMimeType = 'audio/mpeg';

    return NextResponse.json({
      ok: true,
      audioData: finalAudioData,
      mimeType: finalMimeType,
    });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: e.message },
        { status: e.status }
      );
    }

    console.error('[api/voices/preview] Error:', e);
    return NextResponse.json(
      { ok: false, errorMessage: e.message || 'Failed to generate preview' },
      { status: 500 }
    );
  }
}
