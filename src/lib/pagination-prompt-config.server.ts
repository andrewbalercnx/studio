'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { PaginationPromptConfig } from '@/lib/types';
import { DEFAULT_PAGINATION_PROMPT_CONFIG, DEFAULT_PAGINATION_PROMPT } from '@/lib/types';

const PAGINATION_PROMPT_DOC_PATH = 'systemConfig/paginationPrompt';

// Simple in-memory cache with TTL
let cachedConfig: PaginationPromptConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Fetches the pagination prompt configuration from Firestore.
 * Uses a simple in-memory cache to avoid hitting Firestore on every AI request.
 */
export async function getPaginationPromptConfig(): Promise<PaginationPromptConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const firestore = await getServerFirestore();
    const docRef = firestore.doc(PAGINATION_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (doc.exists) {
      cachedConfig = {
        ...DEFAULT_PAGINATION_PROMPT_CONFIG,
        ...doc.data(),
      } as PaginationPromptConfig;
    } else {
      cachedConfig = DEFAULT_PAGINATION_PROMPT_CONFIG;
    }

    cacheTimestamp = now;
    return cachedConfig;
  } catch (error) {
    console.error('[PaginationPromptConfig] Error fetching config:', error);
    // Return default config on error
    return DEFAULT_PAGINATION_PROMPT_CONFIG;
  }
}

/**
 * Gets the pagination prompt string.
 * Returns the configured prompt if enabled, otherwise returns the default.
 * This is the main function AI flows should use.
 */
export async function getPaginationPrompt(): Promise<string> {
  const config = await getPaginationPromptConfig();
  if (config.enabled && config.paginationPrompt) {
    return config.paginationPrompt;
  }
  // Always return the default prompt since pagination needs it
  return DEFAULT_PAGINATION_PROMPT;
}

/**
 * Clears the cache, forcing the next call to fetch from Firestore.
 * Useful for admin updates.
 */
export async function clearPaginationPromptConfigCache(): Promise<void> {
  cachedConfig = null;
  cacheTimestamp = 0;
}
