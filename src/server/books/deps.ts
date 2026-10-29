/**
 * What the Book pipeline's job handlers depend on, injectable so the whole
 * pipeline runs in unit tests (fake Firestore, in-process dispatcher, fake AI,
 * in-memory Storage) and in TEST_MODE without any model call.
 */
import type { AIHarness } from '../ai/harness';
import type { ConfigService } from '../config/config-service';
import { fetchImageAsDataUri, firebaseBlobStore, type BlobStore, type FetchImage } from './media';

/** Text to speech for one narration clip; returns MP3 bytes. */
export type TextToSpeech = (input: { text: string; voiceId: string; modelId: string }) => Promise<Buffer>;

export type BookJobDeps = {
  ai: Pick<AIHarness, 'generateText' | 'generateImage' | 'call'>;
  blobs: BlobStore;
  fetchImage: FetchImage;
  tts: TextToSpeech;
  config: Pick<ConfigService, 'get'>;
  /** TEST_MODE seam (src/lib/test-mode.ts): write fixtures instead of calling AI / TTS. */
  testMode: () => boolean;
  now: () => Date;
};

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** ElevenLabs, as story-page-audio-flow.ts calls it (one clip, 120 s timeout). */
export const elevenLabsTextToSpeech: TextToSpeech = async ({ text, voiceId, modelId }) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    const { JobFailure } = await import('../jobs/registry');
    throw new JobFailure('TTS_NOT_CONFIGURED', 'Text-to-speech service is not configured', { retryable: false });
  }
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  const client = new ElevenLabsClient({ apiKey });
  const stream = await client.textToSpeech.convert(voiceId, { text, modelId }, { timeoutInSeconds: 120, maxRetries: 0 });
  return streamToBuffer(stream as unknown as ReadableStream<Uint8Array>);
};

let defaults: BookJobDeps | null = null;

/** Production dependencies: the shared AI harness, Firebase Storage, ElevenLabs, env TEST_MODE. */
export async function defaultBookJobDeps(): Promise<BookJobDeps> {
  if (defaults) return defaults;
  const [{ getAIHarness }, { configService }, { isTestMode }] = await Promise.all([
    import('../ai/harness'),
    import('../config/config-service'),
    import('@/lib/test-mode'),
  ]);
  defaults = {
    ai: getAIHarness(),
    blobs: firebaseBlobStore,
    fetchImage: fetchImageAsDataUri,
    tts: elevenLabsTextToSpeech,
    config: configService,
    testMode: () => isTestMode(),
    now: () => new Date(),
  };
  return defaults;
}
