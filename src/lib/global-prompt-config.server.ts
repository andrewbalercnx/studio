'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { GlobalPromptConfig } from '@/lib/types';
import { DEFAULT_GLOBAL_PROMPT_CONFIG } from '@/lib/types';

const GLOBAL_PROMPT_DOC_PATH = 'systemConfig/prompts';

// Simple in-memory cache with TTL
let cachedConfig: GlobalPromptConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Fetches the global prompt configuration from Firestore.
 * Uses a simple in-memory cache to avoid hitting Firestore on every AI request.
 */
export async function getGlobalPromptConfig(): Promise<GlobalPromptConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const firestore = await getServerFirestore();
    const docRef = firestore.doc(GLOBAL_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (doc.exists) {
      cachedConfig = {
        ...DEFAULT_GLOBAL_PROMPT_CONFIG,
        ...doc.data(),
      } as GlobalPromptConfig;
    } else {
      cachedConfig = DEFAULT_GLOBAL_PROMPT_CONFIG;
    }

    cacheTimestamp = now;
    return cachedConfig;
  } catch (error) {
    console.error('[GlobalPromptConfig] Error fetching config:', error);
    // Return default config on error
    return DEFAULT_GLOBAL_PROMPT_CONFIG;
  }
}

/**
 * Gets the global prefix string if enabled, or empty string if disabled.
 * This is the main function AI flows should use.
 */
export async function getGlobalPrefix(): Promise<string> {
  const config = await getGlobalPromptConfig();
  if (config.enabled && config.globalPrefix) {
    return config.globalPrefix;
  }
  return '';
}

/**
 * Clears the cache, forcing the next call to fetch from Firestore.
 * Useful for admin updates.
 */
export async function clearGlobalPromptConfigCache(): Promise<void> {
  cachedConfig = null;
  cacheTimestamp = 0;
}
