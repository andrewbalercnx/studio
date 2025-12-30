import { NextResponse } from 'next/server';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { ELEVENLABS_TTS_VOICES, ELEVENLABS_MODEL, DEFAULT_TTS_VOICE } from '@/lib/tts-config';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { resolveEntitiesInText, replacePlaceholdersForTTS } from '@/lib/resolve-placeholders.server';

// Valid preset voice IDs from shared config
const VALID_PRESET_VOICE_IDS = ELEVENLABS_TTS_VOICES.map(v => v.id);

type TTSRequest = {
  text: string;
  voiceId?: string;
  childId?: string;
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
 * API route for generating TTS audio on demand.
 * Used for real-time speech in the child's story creation interface.
 *
 * Supports:
 * - Preset ElevenLabs voices
 * - Parent cloned voices (validated against user's voices collection)
 * - Child's preferred voice (from child profile)
 *
 * Returns base64-encoded MP3 audio for immediate playback.
 */
export async function POST(request: Request) {
  try {
    // Extract auth token from header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing authorization header' },
        { status: 401 }
      );
    }

    const idToken = authHeader.slice(7);

    await initFirebaseAdminApp();
    const auth = getAuth();
    const firestore = getFirestore();

    // Verify the token
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (e) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Invalid authorization token' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as TTSRequest;
    const { text, voiceId, childId } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing text parameter' },
        { status: 400 }
      );
    }

    // Limit text length to prevent abuse (roughly 30 seconds of speech)
    if (text.length > 1000) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Text too long (max 1000 characters)' },
        { status: 400 }
      );
    }

    // Determine which voice to use
    let finalVoiceId = voiceId || DEFAULT_TTS_VOICE;

    // If childId provided, look up child's preferred voice
    if (childId && !voiceId) {
      const childDoc = await firestore.collection('children').doc(childId).get();
      if (childDoc.exists) {
        const childData = childDoc.data();
        if (childData?.preferredVoiceId) {
          finalVoiceId = childData.preferredVoiceId;
        }
      }
    }

    // Validate the voice ID
    const isPresetVoice = VALID_PRESET_VOICE_IDS.includes(finalVoiceId as any);

    if (!isPresetVoice) {
      // Check if it's a valid cloned voice belonging to the parent
      const voiceDoc = await firestore
        .collection('users')
        .doc(decodedToken.uid)
        .collection('voices')
        .doc(finalVoiceId)
        .get();

      if (!voiceDoc.exists) {
        // Fall back to default voice
        console.warn(`[api/tts] Voice ${finalVoiceId} not found, using default`);
        finalVoiceId = DEFAULT_TTS_VOICE;
      }
    }

    // Resolve any placeholders using namePronunciation for correct TTS
    // This handles $$childId$$ or $$characterId$$ patterns in the text
    let textForTTS = text;
    if (text.includes('$$')) {
      const entityMap = await resolveEntitiesInText(text);
      textForTTS = await replacePlaceholdersForTTS(text, entityMap);
    }

    // Check for API key before initializing client
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('[api/tts] ELEVENLABS_API_KEY environment variable not set');
      return NextResponse.json(
        { ok: false, errorMessage: 'Text-to-speech service is not configured. Please contact support.' },
        { status: 503 }
      );
    }

    // Initialize ElevenLabs client
    const elevenlabs = new ElevenLabsClient({
      apiKey,
    });

    // Generate audio
    // Note: eleven_multilingual_v2 auto-detects language and doesn't support languageCode parameter
    // Use longer timeout and retries for reliability on Cloud Run
    const audioStream = await elevenlabs.textToSpeech.convert(
      finalVoiceId,
      {
        text: textForTTS,
        modelId: ELEVENLABS_MODEL,
      },
      {
        timeoutInSeconds: 60,
        maxRetries: 2,
      }
    );

    // Convert stream to buffer
    const audioBuffer = await streamToBuffer(audioStream as unknown as ReadableStream<Uint8Array>);

    // Return base64-encoded MP3
    const audioData = audioBuffer.toString('base64');

    return NextResponse.json({
      ok: true,
      audioData,
      mimeType: 'audio/mpeg',
      voiceId: finalVoiceId,
    });
  } catch (e: any) {
    console.error('[api/tts] Error:', e);
    return NextResponse.json(
      { ok: false, errorMessage: e.message || 'Failed to generate speech' },
      { status: 500 }
    );
  }
}
