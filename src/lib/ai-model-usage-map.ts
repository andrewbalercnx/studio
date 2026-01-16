/**
 * Map of model config keys to the flows that use them.
 * Used in the admin UI to show which flows are affected by each model.
 *
 * Separated from ai-model-config.ts because 'use server' files can only export async functions.
 */

import type { AIModelsConfig } from './types';

export const MODEL_USAGE_MAP: Record<keyof Omit<AIModelsConfig, 'availabilityCheck' | 'updatedAt' | 'updatedBy'>, string[]> = {
  imageGenerationModel: [
    'story-image-flow.ts',
    'avatar-flow.ts',
    'actor-exemplar-flow.ts',
    'character-avatar-flow.ts',
    'image-style-sample-flow.ts',
    'avatar-animation-flow.ts',
    'story-exemplar-generation-flow.ts',
    'story-actor-avatar-flow.ts',
    'story-output-type-image-flow.ts',
  ],
  primaryTextModel: [
    'gemini3-flow.ts',
    'gemini4-flow.ts',
    'story-beat-flow.ts',
    'character-profile-generator.ts',
    'warmup-reply-flow.ts',
    'story-text-compile-flow.ts',
    'character-traits-flow.ts',
    'ending-flow.ts',
  ],
  lightweightTextModel: [
    'story-synopsis-flow.ts',
    'image-description-flow.ts',
  ],
  legacyTextModel: [
    'story-title-flow.ts',
    'story-pagination-flow.ts',
  ],
};
