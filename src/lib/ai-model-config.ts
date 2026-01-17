'use server';

/**
 * Central AI model configuration module.
 *
 * Provides functions to get AI model names from a central Firestore configuration.
 * Priority order:
 * 1. Environment variable (highest - for deployment-specific overrides)
 * 2. Firestore config (systemConfig/aiModels)
 * 3. Hardcoded defaults (lowest)
 *
 * Includes a 1-minute cache to avoid excessive Firestore reads.
 */

import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { AIModelsConfig } from './types';
import { DEFAULT_AI_MODELS_CONFIG } from './types';

// Cache for model config
let cachedConfig: AIModelsConfig | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Get the full AI models configuration.
 * Reads from Firestore with caching, falls back to defaults if not found.
 */
export async function getAIModelConfig(): Promise<AIModelsConfig> {
  // Return cached if valid
  if (cachedConfig && Date.now() < cacheExpiry) {
    return cachedConfig;
  }

  try {
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const doc = await firestore.doc('systemConfig/aiModels').get();

    if (doc.exists) {
      cachedConfig = { ...DEFAULT_AI_MODELS_CONFIG, ...doc.data() } as AIModelsConfig;
    } else {
      cachedConfig = DEFAULT_AI_MODELS_CONFIG;
    }

    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return cachedConfig;
  } catch (error) {
    console.error('[ai-model-config] Failed to load config:', error);
    return DEFAULT_AI_MODELS_CONFIG;
  }
}

/**
 * Get the image generation model name.
 * Priority: STORYBOOK_IMAGE_MODEL env var > Firestore config > default
 */
export async function getImageGenerationModel(): Promise<string> {
  // Allow env var override for backward compatibility
  if (process.env.STORYBOOK_IMAGE_MODEL) {
    console.log('[ai-model-config] Using STORYBOOK_IMAGE_MODEL env var:', process.env.STORYBOOK_IMAGE_MODEL);
    return process.env.STORYBOOK_IMAGE_MODEL;
  }
  const config = await getAIModelConfig();
  console.log('[ai-model-config] Image generation model from config:', config.imageGenerationModel);
  return config.imageGenerationModel;
}

/**
 * Get the primary text model name (for complex tasks).
 */
export async function getPrimaryTextModel(): Promise<string> {
  const config = await getAIModelConfig();
  return config.primaryTextModel;
}

/**
 * Get the lightweight text model name (for simple, fast tasks).
 */
export async function getLightweightTextModel(): Promise<string> {
  const config = await getAIModelConfig();
  return config.lightweightTextModel;
}

/**
 * Get the legacy text model name (for specific older use cases).
 */
export async function getLegacyTextModel(): Promise<string> {
  const config = await getAIModelConfig();
  return config.legacyTextModel;
}

/**
 * Clear the config cache.
 * Call this after updating the config to ensure flows pick up new values.
 */
export async function clearModelConfigCache(): Promise<void> {
  cachedConfig = null;
  cacheExpiry = 0;
}
