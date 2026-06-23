/**
 * Streaming-vs-buffered TTS time-to-first-audio. The §2.3 latency budget needs streaming
 * (today's /api/tts buffers the whole clip — exactly what blows the budget). This measures the gap.
 *
 * Exports measureTts() so run.mjs can reuse it; runnable standalone too:
 *   node --env-file=spikes/.env spikes/latency/tts-stream.mjs "What happens next?"
 */
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // a built-in voice
const MODEL = 'eleven_flash_v2_5'; // lowest-latency model; the app uses a config lookup in prod

export function getClient() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('Set ELEVENLABS_API_KEY in spikes/.env');
  return new ElevenLabsClient({ apiKey });
}

/** Streaming: time to FIRST audio chunk (what a child actually waits for) + time to last. */
export async function measureStreaming(text, client = getClient(), voiceId = DEFAULT_VOICE) {
  const t0 = Date.now();
  const stream = await client.textToSpeech.stream(voiceId, { text, modelId: MODEL });
  let firstChunkMs = null, bytes = 0;
  for await (const chunk of stream) {
    if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
    bytes += chunk.length ?? chunk.byteLength ?? 0;
  }
  return { mode: 'streaming', firstAudioMs: firstChunkMs, totalMs: Date.now() - t0, bytes };
}

/** Buffered: you can't play until the whole clip is drained — first audio == total. */
export async function measureBuffered(text, client = getClient(), voiceId = DEFAULT_VOICE) {
  const t0 = Date.now();
  const stream = await client.textToSpeech.convert(voiceId, { text, modelId: MODEL });
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length ?? chunk.byteLength ?? 0;
  const totalMs = Date.now() - t0;
  return { mode: 'buffered', firstAudioMs: totalMs, totalMs, bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2] || 'What happens next in your story?';
  const client = getClient();
  const s = await measureStreaming(text, client);
  const b = await measureBuffered(text, client);
  console.table([s, b]);
  console.log(`\nStreaming saves ~${b.firstAudioMs - s.firstAudioMs}ms to first audio on this clip.`);
}
