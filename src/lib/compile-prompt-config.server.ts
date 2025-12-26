'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { CompilePromptConfig } from '@/lib/types';
import { DEFAULT_COMPILE_PROMPT_CONFIG } from '@/lib/types';

const COMPILE_PROMPT_DOC_PATH = 'systemConfig/compilePrompt';

// Simple in-memory cache with TTL
let cachedConfig: CompilePromptConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Fetches the compile prompt configuration from Firestore.
 * Uses a simple in-memory cache to avoid hitting Firestore on every AI request.
 */
export async function getCompilePromptConfig(): Promise<CompilePromptConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const firestore = await getServerFirestore();
    const docRef = firestore.doc(COMPILE_PROMPT_DOC_PATH);
    const doc = await docRef.get();

    if (doc.exists) {
      cachedConfig = {
        ...DEFAULT_COMPILE_PROMPT_CONFIG,
        ...doc.data(),
      } as CompilePromptConfig;
    } else {
      cachedConfig = DEFAULT_COMPILE_PROMPT_CONFIG;
    }

    cacheTimestamp = now;
    return cachedConfig;
  } catch (error) {
    console.error('[CompilePromptConfig] Error fetching config:', error);
    // Return default config on error
    return DEFAULT_COMPILE_PROMPT_CONFIG;
  }
}

/**
 * Gets the compile prompt string if enabled, or empty string if disabled.
 * This is the main function AI flows should use.
 */
export async function getCompilePrompt(): Promise<string> {
  const config = await getCompilePromptConfig();
  if (config.enabled && config.compilePrompt) {
    return config.compilePrompt;
  }
  return '';
}

/**
 * Clears the cache, forcing the next call to fetch from Firestore.
 * Useful for admin updates.
 */
export async function clearCompilePromptConfigCache(): Promise<void> {
  cachedConfig = null;
  cacheTimestamp = 0;
}
