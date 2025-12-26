import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { GEMINI_TTS_VOICES } from '@/lib/tts-config';

/**
 * Convert raw PCM audio data to WAV format by adding proper headers.
 * Gemini TTS returns audio/L16 (16-bit linear PCM) which browsers cannot play directly.
 */
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000, channels: number = 1, bitsPerSample: number = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize - 8;

  const wavBuffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(fileSize, 4);
  wavBuffer.write('WAVE', 8);

  // fmt subchunk
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);

  pcmBuffer.copy(wavBuffer, headerSize);

  return wavBuffer;
}

/**
 * Parse sample rate from mime type like "audio/L16;codec=pcm;rate=24000"
 */
function parseSampleRate(mimeType: string): number {
  const rateMatch = mimeType.match(/rate=(\d+)/);
  return rateMatch ? parseInt(rateMatch[1], 10) : 24000;
}

// Sample text for voice preview - short and engaging
const PREVIEW_TEXT = "Once upon a time, in a magical forest filled with wonder, there lived a brave little adventurer who loved to explore.";

// Valid voice IDs from shared config
const VALID_VOICE_IDS = GEMINI_TTS_VOICES.map(v => v.id);

type PreviewRequest = {
  voiceName: string;
};

/**
 * API route for generating a voice preview sample.
 * Returns base64-encoded audio data for immediate playback.
 */
export async function POST(request: Request) {
  try {
    await requireParentOrAdminUser(request);

    const body = (await request.json()) as PreviewRequest;
    const { voiceName } = body;

    if (!voiceName || typeof voiceName !== 'string') {
      return NextResponse.json(
        { ok: false, errorMessage: 'Missing voiceName' },
        { status: 400 }
      );
    }

    // Validate voice name against known voices
    if (!VALID_VOICE_IDS.includes(voiceName as any)) {
      return NextResponse.json(
        { ok: false, errorMessage: `Invalid voice: ${voiceName}` },
        { status: 400 }
      );
    }

    // Initialize Gemini client
    const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    // Generate audio preview
    const response = await genai.models.generateContent({
      model: 'gemini-2.5-pro-preview-tts',
      contents: `Read aloud warmly with a British English accent: ${PREVIEW_TEXT}`,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            },
          },
        },
      },
    });

    // Extract audio data
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!audioData?.data) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Failed to generate audio preview' },
        { status: 500 }
      );
    }

    const rawMimeType = audioData.mimeType || 'audio/wav';
    let finalAudioData: string;
    let finalMimeType: string;

    // Convert PCM to WAV if needed (Gemini TTS returns audio/L16 which browsers can't play)
    if (rawMimeType.includes('L16') || rawMimeType.includes('pcm')) {
      const rawBuffer = Buffer.from(audioData.data, 'base64');
      const sampleRate = parseSampleRate(rawMimeType);
      const wavBuffer = pcmToWav(rawBuffer, sampleRate);
      finalAudioData = wavBuffer.toString('base64');
      finalMimeType = 'audio/wav';
    } else {
      finalAudioData = audioData.data;
      finalMimeType = rawMimeType;
    }

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
