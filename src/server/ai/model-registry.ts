/**
 * AI model registry by purpose (ADR-0008).
 *
 * `config/aiModels` maps each purpose to a model id; anything not set there
 * falls back to the code defaults below, which match the models today's flows
 * use for the same work. A CreationMode may override `creation.text` only;
 * nothing else picks a model.
 */
import { z } from 'zod';
import { configService, defineConfig, type ConfigService } from '../config/config-service';
import { currentModelId } from '../../lib/retired-models';

export const AI_PURPOSES = [
  'creation.text',
  'manuscript.text',
  'likeness.describe',
  'likeness.portrait',
  'book.castSheet',
  'book.pageArt',
  'narration',
] as const;
export type AIPurpose = (typeof AI_PURPOSES)[number];

export type AIPurposeKind = 'text' | 'image' | 'tts';

/** What each purpose produces; the harness uses it to pick the call shape and circuit breaker. */
export const AI_PURPOSE_KIND: Record<AIPurpose, AIPurposeKind> = {
  'creation.text': 'text',
  'manuscript.text': 'text',
  'likeness.describe': 'text',
  'likeness.portrait': 'image',
  'book.castSheet': 'image',
  'book.pageArt': 'image',
  narration: 'tts',
};

/**
 * Code defaults, taken from the flows doing this work today:
 * - creation.text: gemini-3.8-flash (wizard, gemini3/4, friends, ending)
 * - manuscript.text: gemini-3.8-flash (story-pagination-flow)
 * - likeness.describe: gemini-3.8-flash (image-description-flow)
 * - image purposes: gemini-3.1-flash-image (DEFAULT_AI_MODELS_CONFIG.imageGenerationModel)
 * - narration: ElevenLabs eleven_v3 (default ElevenLabs version in diagnostics config)
 */
export const DEFAULT_AI_MODELS: Record<AIPurpose, string> = {
  'creation.text': 'googleai/gemini-3.8-flash',
  'manuscript.text': 'googleai/gemini-3.8-flash',
  'likeness.describe': 'googleai/gemini-3.8-flash',
  'likeness.portrait': 'googleai/gemini-3.1-flash-image',
  'book.castSheet': 'googleai/gemini-3.1-flash-image',
  'book.pageArt': 'googleai/gemini-3.1-flash-image',
  narration: 'elevenlabs/eleven_v3',
};

const purposeModelsSchema = z
  .object(
    Object.fromEntries(AI_PURPOSES.map((purpose) => [purpose, z.string().min(1)])) as Record<
      AIPurpose,
      z.ZodString
    >
  )
  .partial();

/** `config/aiModels`: `{ purposes: { 'creation.text': 'googleai/…', … } }`. */
export const aiModelsConfig = defineConfig({
  path: 'config/aiModels',
  schema: z.object({ purposes: purposeModelsSchema.default({}) }),
  defaults: { purposes: {} },
  ttlMs: 30_000,
});

export type ResolvedModel = {
  purpose: AIPurpose;
  model: string;
  kind: AIPurposeKind;
  source: 'creationMode' | 'config' | 'default';
};

export type ResolveOptions = {
  /** The CreationMode's model override; honoured for `creation.text` only. */
  creationModeModel?: string | null;
};

export class AIModelRegistry {
  constructor(private readonly config: Pick<ConfigService, 'get'> = configService) {}

  async resolve(purpose: AIPurpose, options: ResolveOptions = {}): Promise<ResolvedModel> {
    if (!AI_PURPOSES.includes(purpose)) {
      throw new Error(`Unknown AI purpose "${purpose}"`);
    }
    const kind = AI_PURPOSE_KIND[purpose];
    if (options.creationModeModel) {
      if (purpose !== 'creation.text') {
        throw new Error(`A CreationMode may override creation.text only, not ${purpose}`);
      }
      return { purpose, model: currentModelId(options.creationModeModel), kind, source: 'creationMode' };
    }
    const configured = (await this.config.get(aiModelsConfig)).purposes[purpose];
    if (configured) {
      return { purpose, model: currentModelId(configured), kind, source: 'config' };
    }
    return { purpose, model: DEFAULT_AI_MODELS[purpose], kind, source: 'default' };
  }
}

export const aiModelRegistry = new AIModelRegistry();
