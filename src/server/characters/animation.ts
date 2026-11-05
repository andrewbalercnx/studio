/**
 * The animated ("dancing") avatar providers, ported from the former
 * `avatar-animation-flow` (slice 5.7). Called by the
 * `likeness.animate` job through the AI harness (`call`, purpose
 * `likeness.animate`), which adds the circuit breaker, retries and logging the
 * old flow did by hand.
 *
 * The model id picks the provider:
 * - `fal-ai/…` (default `fal-ai/kling-video/v1.6/pro/image-to-video`): fal.ai
 *   queue API with `FAL_KEY`; the same image as head and tail frame loops it.
 * - `veo-…` or `googleai/veo-…`: Veo through the Gemini API long-running
 *   `predictLongRunning`, with `GEMINI_API_KEY`.
 */
import { JobFailure } from '../jobs/registry';

export type VideoResult = { bytes: Buffer; contentType: string; generatedWith: string };
export type FetchLike = typeof fetch;

export const ANIMATION_PROMPT =
  'A cute cartoon character dancing joyfully. The character sways side to side, waves their arms, and bobs gently up and down in a happy dance. They stay in place. Smooth looping motion appropriate for young children.';

const POLL_MS = 5_000;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
}

/** fal.ai image-to-video: submit, poll up to ~3 minutes, download. */
export async function falImageToVideo(input: {
  model: string;
  imageUrl: string;
  key: string | undefined;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  maxPolls?: number;
}): Promise<VideoResult> {
  const { model, imageUrl, key } = input;
  if (!key) throw new JobFailure('ANIMATION_NOT_CONFIGURED', 'FAL_KEY is not set', { retryable: false });
  const f = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? realSleep;
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submitted = await json<{ request_id?: string; status_url?: string; response_url?: string }>(
    await f(`https://queue.fal.run/${model}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image_url: imageUrl, tail_image_url: imageUrl, prompt: ANIMATION_PROMPT, duration: '5', aspect_ratio: '1:1' }),
    }),
    'fal.ai submit'
  );
  if (!submitted.status_url || !submitted.response_url) throw new Error('fal.ai submit response missing status_url/response_url');
  for (let poll = 0; poll < (input.maxPolls ?? 36); poll++) {
    await sleep(POLL_MS);
    const status = await json<{ status?: string; error?: unknown }>(await f(submitted.status_url, { headers }), 'fal.ai status');
    if (status.status === 'FAILED') throw new Error(`fal.ai job failed: ${JSON.stringify(status.error ?? 'unknown').slice(0, 200)}`);
    if (status.status === 'COMPLETED') {
      const result = await json<{ video?: { url?: string } }>(await f(submitted.response_url, { headers }), 'fal.ai result');
      const videoUrl = result.video?.url;
      if (!videoUrl) throw new Error('fal.ai completed without a video URL');
      const video = await f(videoUrl);
      if (!video.ok) throw new Error(`fal.ai video download failed: ${video.status}`);
      return { bytes: Buffer.from(await video.arrayBuffer()), contentType: 'video/mp4', generatedWith: model };
    }
  }
  throw new Error('fal.ai timed out with no video');
}

/** Veo through the Gemini API: start a long-running operation, poll up to ~2 minutes, read the sample. */
export async function veoImageToVideo(input: {
  model: string;
  image: { bytes: Buffer; contentType: string };
  key: string | undefined;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  maxPolls?: number;
}): Promise<VideoResult> {
  if (!input.key) throw new JobFailure('ANIMATION_NOT_CONFIGURED', 'GEMINI_API_KEY is not set', { retryable: false });
  const f = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? realSleep;
  const model = input.model.replace(/^googleai\//, '');
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const started = await json<{ name?: string }>(
    await f(`${base}/models/${model}:predictLongRunning?key=${input.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: ANIMATION_PROMPT, image: { bytesBase64Encoded: input.image.bytes.toString('base64'), mimeType: input.image.contentType } }],
        parameters: { aspectRatio: '1:1', sampleCount: 1, durationSeconds: 5 },
      }),
    }),
    'Veo start'
  );
  if (!started.name) throw new Error('Veo start returned no operation name');
  for (let poll = 0; poll < (input.maxPolls ?? 24); poll++) {
    await sleep(POLL_MS);
    type Op = { done?: boolean; error?: { message?: string }; response?: Record<string, unknown> };
    const op = await json<Op>(await f(`${base}/${started.name}?key=${input.key}`), 'Veo poll');
    if (op.error) throw new Error(`Veo operation error: ${op.error.message ?? 'unknown'}`);
    if (!op.done) continue;
    const response = (op.response ?? {}) as { generatedSamples?: Array<{ video?: { bytesBase64Encoded?: string; uri?: string } }>; generateVideoResponse?: { generatedSamples?: Array<{ video?: { bytesBase64Encoded?: string; uri?: string } }> } };
    const video = (response.generatedSamples ?? response.generateVideoResponse?.generatedSamples)?.[0]?.video;
    if (video?.bytesBase64Encoded) return { bytes: Buffer.from(video.bytesBase64Encoded, 'base64'), contentType: 'video/mp4', generatedWith: model };
    if (video?.uri) {
      const url = video.uri.startsWith('https://') ? video.uri : `${base}/files/${video.uri.split('/').pop()}?key=${input.key}`;
      const downloaded = await f(url);
      if (!downloaded.ok) throw new Error(`Veo video download failed: ${downloaded.status}`);
      return { bytes: Buffer.from(await downloaded.arrayBuffer()), contentType: 'video/mp4', generatedWith: model };
    }
    throw new Error('Veo completed without a video');
  }
  throw new Error('Veo timed out with no video');
}

export function isVeoModel(model: string): boolean {
  return /(^|\/)veo-/.test(model);
}
