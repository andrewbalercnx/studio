'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { ImagePromptConfig } from '@/lib/types';
import { DEFAULT_IMAGE_PROMPT_CONFIG, DEFAULT_IMAGE_PROMPT } from '@/lib/types';

const IMAGE_PROMPT_DOC_PATH = 'systemConfig/imagePrompt';

// Simple in-memory cache with TTL
let cachedConfig: ImagePromptConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Fetches the image prompt configuration from Firestore.
 * Uses a simple in-memory cache to avoid hitting Firestore on every image generation request.
 */
export async function getImagePromptConfig(): Promise<ImagePromptConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const firestore = await getServerFirestore();
    const docRef = firestore.doc(IMAGE_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (doc.exists) {
      cachedConfig = {
        ...DEFAULT_IMAGE_PROMPT_CONFIG,
        ...doc.data(),
      } as ImagePromptConfig;
    } else {
      cachedConfig = DEFAULT_IMAGE_PROMPT_CONFIG;
    }

    cacheTimestamp = now;
    return cachedConfig;
  } catch (error) {
    console.error('[ImagePromptConfig] Error fetching config:', error);
    // Return default config on error
    return DEFAULT_IMAGE_PROMPT_CONFIG;
  }
}

/**
 * Gets the global image prompt string if enabled, or empty string if disabled.
 * This is the main function the image generation flow should use.
 */
export async function getGlobalImagePrompt(): Promise<string> {
  const config = await getImagePromptConfig();
  if (config.enabled && config.imagePrompt) {
    return config.imagePrompt;
  }
  return '';
}

/**
 * Gets the global image prompt string, or the default if not configured.
 * Use this when you always want some prompt (never empty).
 */
export async function getGlobalImagePromptOrDefault(): Promise<string> {
  const config = await getImagePromptConfig();
  if (config.enabled && config.imagePrompt) {
    return config.imagePrompt;
  }
  return DEFAULT_IMAGE_PROMPT;
}

/**
 * Clears the cache, forcing the next call to fetch from Firestore.
 * Useful for admin updates.
 */
export async function clearImagePromptConfigCache(): Promise<void> {
  cachedConfig = null;
  cacheTimestamp = 0;
}
