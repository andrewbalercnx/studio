import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { withRetry } from '@/lib/ai-retry';
import { PROVIDER_GEMINI_IMAGE, PROVIDER_GEMINI_TEXT, type ProviderReliabilityOptions } from '@/lib/ai-circuit-breaker.server';
import { AIHarness, NoImageReturnedError, type AICallLogEntry, type GenerateFn } from '../harness';
import type { AIPurpose, ResolveOptions } from '../model-registry';
import { AI_PURPOSE_KIND } from '../model-registry';

const registry = {
  resolve: vi.fn(async (purpose: AIPurpose, options: ResolveOptions = {}) => ({
    purpose,
    model: options.creationModeModel ?? `model-for-${purpose}`,
    kind: AI_PURPOSE_KIND[purpose],
    source: 'default' as const,
  })),
};

let providers: string[];
/** Real retry policy, no breaker, no sleeping. */
const reliability = async <T,>(provider: string, fn: () => Promise<T>, options?: ProviderReliabilityOptions) => {
  providers.push(provider);
  return withRetry(fn, { ...options, sleep: async () => undefined });
};

let logs: AICallLogEntry[];
let loggingEnabled: boolean;
const config = { get: vi.fn(async () => ({ enableAIFlowLogging: loggingEnabled, enableServerLogging: true })) };

function harness(generate: GenerateFn) {
  return new AIHarness({
    registry,
    generate,
    reliability,
    log: async (entry) => {
      logs.push(entry);
    },
    config: config as never,
  });
}

beforeEach(() => {
  providers = [];
  logs = [];
  loggingEnabled = true;
  registry.resolve.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('AIHarness.generateText', () => {
  it('resolves the model by purpose, calls generate and logs the call', async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue({ text: 'Once upon a time', output: { title: 'Moon' } });
    const result = await harness(generate).generateText({
      purpose: 'manuscript.text',
      flowName: 'manuscript.paginate',
      ownerUid: 'u1',
      system: 'You are a children’s editor',
      prompt: 'Paginate this',
      output: { schema: z.object({ title: z.string() }) },
      config: { temperature: 0.4 },
    });

    expect(result).toMatchObject({ text: 'Once upon a time', output: { title: 'Moon' }, attempts: 1 });
    expect(result.model.model).toBe('model-for-manuscript.text');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-for-manuscript.text', prompt: 'Paginate this', config: { temperature: 0.4 } })
    );
    expect(providers).toEqual([PROVIDER_GEMINI_TEXT]);
    expect(logs).toEqual([
      expect.objectContaining({
        flowName: 'manuscript.paginate',
        purpose: 'manuscript.text',
        model: 'model-for-manuscript.text',
        ownerUid: 'u1',
        attempts: 1,
        prompt: '[system] You are a children’s editor\nPaginate this',
      }),
    ]);
  });

  it('passes the CreationMode override through to the registry', async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue({ text: 'hi' });
    const result = await harness(generate).generateText({
      purpose: 'creation.text',
      flowName: 'wizard',
      prompt: 'Hi',
      creationModeModel: 'googleai/special',
    });
    expect(registry.resolve).toHaveBeenCalledWith('creation.text', { creationModeModel: 'googleai/special' });
    expect(result.model.model).toBe('googleai/special');
  });

  it('retries transient errors and logs the final failure of permanent ones', async () => {
    const generate = vi
      .fn<GenerateFn>()
      .mockRejectedValueOnce(new Error('503 UNAVAILABLE'))
      .mockResolvedValueOnce({ text: 'ok' });
    await expect(harness(generate).generateText({ purpose: 'likeness.describe', flowName: 'f', prompt: 'p' })).resolves.toMatchObject({
      text: 'ok',
      attempts: 2,
    });

    const failing = vi.fn<GenerateFn>().mockRejectedValue(new Error('400 INVALID_ARGUMENT'));
    await expect(harness(failing).generateText({ purpose: 'likeness.describe', flowName: 'f', prompt: 'p' })).rejects.toThrow(
      'INVALID_ARGUMENT'
    );
    expect(failing).toHaveBeenCalledTimes(1);
    expect(logs[1]).toMatchObject({ attempts: 1, error: expect.any(Error) });
  });

  it('honours the AI flow logging toggle', async () => {
    loggingEnabled = false;
    await harness(vi.fn<GenerateFn>().mockResolvedValue({ text: 'x' })).generateText({ purpose: 'creation.text', flowName: 'f', prompt: 'p' });
    expect(logs).toEqual([]);
  });

  it('refuses a purpose of the wrong kind', async () => {
    await expect(
      harness(vi.fn<GenerateFn>()).generateText({ purpose: 'book.pageArt', flowName: 'f', prompt: 'p' })
    ).rejects.toThrow(/image purpose/);
  });
});

describe('AIHarness.generateImage', () => {
  it('requests an image on the image breaker and returns the media url', async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue({ text: '', media: { url: 'data:image/png;base64,AAA' } });
    const result = await harness(generate).generateImage({
      purpose: 'book.pageArt',
      flowName: 'book.pageArt',
      prompt: [{ media: { url: 'data:image/png;base64,REF' } }, { text: 'Draw page 3' }],
    });
    expect(result.mediaUrl).toBe('data:image/png;base64,AAA');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-for-book.pageArt', config: { responseModalities: ['TEXT', 'IMAGE'] } })
    );
    expect(providers).toEqual([PROVIDER_GEMINI_IMAGE]);
    expect(logs[0].prompt).toBe('[media]\nDraw page 3');
  });

  it('retries a response without an image, then gives up', async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue({ text: 'I cannot draw that' });
    await expect(
      harness(generate).generateImage({ purpose: 'book.castSheet', flowName: 'f', prompt: 'p' })
    ).rejects.toBeInstanceOf(NoImageReturnedError);
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe('AIHarness.call', () => {
  it('wraps arbitrary provider calls (e.g. narration) with the same policy', async () => {
    const run = vi.fn(async (model: { model: string }) => `audio from ${model.model}`);
    const result = await harness(vi.fn<GenerateFn>()).call({ purpose: 'narration', flowName: 'manuscript.narrate', run, logPrompt: 'Page 1' });
    expect(result.result).toBe('audio from model-for-narration');
    expect(providers).toEqual(['elevenlabs-tts']);
  });
});
