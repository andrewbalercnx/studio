/**
 * The AI harness (ADR-0008): every AI call in rebuilt code goes through here.
 *
 *   resolve model by purpose → circuit breaker + retry → call → log
 *
 * - Model: `AIModelRegistry` (config/aiModels, code defaults, CreationMode
 *   override for creation.text only).
 * - Reliability: `withProviderReliability` from src/lib/ai-circuit-breaker.server.ts
 *   (shared Firestore-backed breaker per provider + jittered retry of
 *   transient errors from src/lib/ai-retry.ts).
 * - Logging: one `aiFlowLogs` entry per call (via src/lib/ai-flow-logger.ts),
 *   written only when `systemConfig/diagnostics.enableAIFlowLogging` is on.
 *
 * Flow code built on it only builds prompts and parses output.
 */
import type { MessageData, Part } from 'genkit';
import type { z } from 'zod';
import {
  PROVIDER_ELEVENLABS_TTS,
  PROVIDER_GEMINI_IMAGE,
  PROVIDER_GEMINI_TEXT,
  withProviderReliability,
  type ProviderReliabilityOptions,
} from '@/lib/ai-circuit-breaker.server';
import { isRetryable } from '@/lib/ai-retry';
import { configService, type ConfigService } from '../config/config-service';
import { diagnosticsConfig } from '../config/definitions';
import {
  AI_PURPOSE_KIND,
  aiModelRegistry,
  type AIModelRegistry,
  type AIPurpose,
  type AIPurposeKind,
  type ResolvedModel,
} from './model-registry';

// ---------------------------------------------------------------------------
// Dependencies (structural, so tests can inject fakes)
// ---------------------------------------------------------------------------

export type GenerateRequest = {
  model: string;
  prompt?: string | Part[];
  system?: string;
  messages?: MessageData[];
  output?: { schema: z.ZodTypeAny };
  config?: Record<string, unknown>;
};

export type GenerateResult = {
  text: string;
  output?: unknown;
  media?: { url: string; contentType?: string } | null;
  usage?: unknown;
  finishReason?: string;
};

export type GenerateFn = (request: GenerateRequest) => Promise<GenerateResult>;

export type ReliabilityFn = <T>(
  providerKey: string,
  fn: () => Promise<T>,
  options?: ProviderReliabilityOptions
) => Promise<T>;

export type AICallLogEntry = {
  flowName: string;
  purpose: AIPurpose;
  model: string;
  ownerUid: string | null;
  prompt: string;
  startTime: number;
  attempts: number;
  response?: unknown;
  error?: unknown;
};

export type AICallLogger = (entry: AICallLogEntry) => Promise<void>;

export type AIHarnessDeps = {
  registry?: Pick<AIModelRegistry, 'resolve'>;
  generate?: GenerateFn;
  reliability?: ReliabilityFn;
  log?: AICallLogger;
  config?: Pick<ConfigService, 'get'>;
};

const PROVIDER_FOR_KIND: Record<AIPurposeKind, string> = {
  text: PROVIDER_GEMINI_TEXT,
  image: PROVIDER_GEMINI_IMAGE,
  tts: PROVIDER_ELEVENLABS_TTS,
};

const defaultGenerate: GenerateFn = async (request) => {
  const { ai } = await import('@/ai/genkit');
  // The structural request maps 1:1 onto Genkit's GenerateOptions.
  return (await ai.generate(request as Parameters<typeof ai.generate>[0])) as unknown as GenerateResult;
};

const defaultLogger: AICallLogger = async (entry) => {
  const { logAIFlow } = await import('@/lib/ai-flow-logger');
  await logAIFlow({
    flowName: entry.flowName,
    parentId: entry.ownerUid,
    prompt: entry.prompt,
    response: entry.response,
    error: entry.error,
    startTime: entry.startTime,
    modelName: entry.model,
    attemptNumber: entry.attempts,
  });
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export type AICallOptions = {
  purpose: AIPurpose;
  /** Name recorded in logs (e.g. `manuscript.paginate`). */
  flowName: string;
  /** Owner of the work, for logs. */
  ownerUid?: string | null;
  /** CreationMode override; only valid with `creation.text`. */
  creationModeModel?: string | null;
};

export type AICallResult<T> = { result: T; model: ResolvedModel; attempts: number };

/** Thrown when an image call returns no image; retried like a transient error. */
/**
 * Gemini 3 thinks at length unless told otherwise, and thinking tokens count
 * against maxOutputTokens: a 50-token title call could spend them all thinking.
 * Every text purpose here is either a child waiting or a short summary, so text
 * calls default to a low thinking level; a caller can still pass its own.
 */
export function withThinkingDefault(model: string, config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!/(^|\/)gemini-3/.test(model) || config?.thinkingConfig) return config;
  return { ...config, thinkingConfig: { thinkingLevel: 'LOW' } };
}

export class NoImageReturnedError extends Error {
  readonly code = 'NO_IMAGE_RETURNED';
  constructor(textPreview: string) {
    super(`Model returned no image (text: "${textPreview.slice(0, 200)}")`);
    this.name = 'NoImageReturnedError';
  }
}

function promptToLogText(prompt: string | Part[] | undefined, system?: string): string {
  const parts: string[] = [];
  if (system) parts.push(`[system] ${system}`);
  if (typeof prompt === 'string') parts.push(prompt);
  else if (Array.isArray(prompt)) {
    for (const part of prompt) {
      if (part.text) parts.push(part.text);
      else if (part.media) parts.push('[media]');
    }
  }
  return parts.join('\n');
}

export class AIHarness {
  private readonly registry: Pick<AIModelRegistry, 'resolve'>;
  private readonly generateFn: GenerateFn;
  private readonly reliability: ReliabilityFn;
  private readonly log: AICallLogger;
  private readonly config: Pick<ConfigService, 'get'>;

  constructor(deps: AIHarnessDeps = {}) {
    this.registry = deps.registry ?? aiModelRegistry;
    this.generateFn = deps.generate ?? defaultGenerate;
    this.reliability = deps.reliability ?? withProviderReliability;
    this.log = deps.log ?? defaultLogger;
    this.config = deps.config ?? configService;
  }

  /**
   * The generic call: resolve the model, run `fn(model)` under the purpose's
   * circuit breaker and retry policy, log the outcome. Text and image variants
   * below are built on it; narration (ElevenLabs) uses it directly.
   */
  async call<T>(
    options: AICallOptions & {
      run: (model: ResolvedModel) => Promise<T>;
      /** Prompt text for the log entry. */
      logPrompt?: string;
      /** Extra retry condition on top of transient errors. */
      retryAlso?: (error: unknown) => boolean;
    }
  ): Promise<AICallResult<T>> {
    const model = await this.registry.resolve(options.purpose, { creationModeModel: options.creationModeModel });
    const startTime = Date.now();
    let attempts = 0;
    let result: T | undefined;
    let failure: unknown;
    try {
      result = await this.reliability(
        PROVIDER_FOR_KIND[model.kind],
        async () => {
          attempts += 1;
          return options.run(model);
        },
        {
          shouldRetry: (error) => isRetryable(error) || (options.retryAlso?.(error) ?? false),
          onRetry: ({ attempt, delayMs, error }) =>
            console.warn(
              `[ai] ${options.flowName} (${options.purpose}) retry ${attempt} in ${delayMs}ms:`,
              (error as Error)?.message ?? error
            ),
        }
      );
    } catch (error) {
      failure = error;
    }

    await this.writeLog({
      flowName: options.flowName,
      purpose: options.purpose,
      model: model.model,
      ownerUid: options.ownerUid ?? null,
      prompt: options.logPrompt ?? '',
      startTime,
      attempts,
      response: failure === undefined ? result : undefined,
      error: failure,
    });

    if (failure !== undefined) throw failure;
    return { result: result as T, model, attempts };
  }

  /** Text generation, optionally with structured output parsed by a zod schema. */
  async generateText<O = unknown>(
    options: AICallOptions & {
      prompt?: string | Part[];
      system?: string;
      messages?: MessageData[];
      output?: { schema: z.ZodType<O> };
      config?: Record<string, unknown>;
    }
  ): Promise<{ text: string; output: O | null; model: ResolvedModel; usage: unknown; attempts: number }> {
    this.assertKind(options.purpose, 'text');
    const { result, model, attempts } = await this.call({
      ...options,
      logPrompt: promptToLogText(options.prompt, options.system),
      run: (resolved) =>
        this.generateFn({
          model: resolved.model,
          prompt: options.prompt,
          system: options.system,
          messages: options.messages,
          output: options.output,
          config: withThinkingDefault(resolved.model, options.config),
        }),
    });
    return {
      text: result.text,
      output: (result.output ?? null) as O | null,
      model,
      usage: result.usage,
      attempts,
    };
  }

  /** Image generation. Returns the generated image as a (data) URL. */
  async generateImage(
    options: AICallOptions & {
      prompt: string | Part[];
      config?: Record<string, unknown>;
    }
  ): Promise<{ mediaUrl: string; text: string; model: ResolvedModel; attempts: number }> {
    this.assertKind(options.purpose, 'image');
    const { result, model, attempts } = await this.call({
      ...options,
      logPrompt: promptToLogText(options.prompt),
      retryAlso: (error) => error instanceof NoImageReturnedError,
      run: async (resolved) => {
        const response = await this.generateFn({
          model: resolved.model,
          prompt: options.prompt,
          config: { responseModalities: ['TEXT', 'IMAGE'], ...options.config },
        });
        if (!response.media?.url) throw new NoImageReturnedError(response.text ?? '');
        return response;
      },
    });
    return { mediaUrl: result.media!.url, text: result.text ?? '', model, attempts };
  }

  private assertKind(purpose: AIPurpose, kind: AIPurposeKind): void {
    if (AI_PURPOSE_KIND[purpose] !== kind) {
      throw new Error(`Purpose ${purpose} is a ${AI_PURPOSE_KIND[purpose]} purpose, not ${kind}`);
    }
  }

  private async writeLog(entry: AICallLogEntry): Promise<void> {
    try {
      const diagnostics = await this.config.get(diagnosticsConfig);
      if (!diagnostics.enableAIFlowLogging) return;
      await this.log(entry);
    } catch (error) {
      console.warn('[ai] Failed to write AI call log', (error as Error)?.message ?? error);
    }
  }
}

let defaultHarness: AIHarness | null = null;

/** The process-wide harness over the shared Genkit instance. */
export function getAIHarness(): AIHarness {
  defaultHarness ??= new AIHarness();
  return defaultHarness;
}
