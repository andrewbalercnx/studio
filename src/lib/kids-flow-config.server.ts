'use server';

import { getServerFirestore } from '@/lib/server-firestore';
import type { KidsFlowConfig } from '@/lib/types';
import { DEFAULT_KIDS_FLOW_CONFIG } from '@/lib/types';

const KIDS_FLOW_DOC_PATH = 'systemConfig/kidsFlows';

// Simple in-memory cache with TTL
let cachedConfig: KidsFlowConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Fetches the kids flow configuration from Firestore.
 * Uses a simple in-memory cache to avoid hitting Firestore on every request.
 */
export async function getKidsFlowConfig(): Promise<KidsFlowConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const firestore = await getServerFirestore();
    const docRef = firestore.doc(KIDS_FLOW_DOC_PATH);
    const doc = await docRef.get();

    if (doc.exists) {
      cachedConfig = {
        ...DEFAULT_KIDS_FLOW_CONFIG,
        ...doc.data(),
      } as KidsFlowConfig;
    } else {
      cachedConfig = DEFAULT_KIDS_FLOW_CONFIG;
    }

    cacheTimestamp = now;
    return cachedConfig;
  } catch (error) {
    console.error('[KidsFlowConfig] Error fetching config:', error);
    // Return default config on error
    return DEFAULT_KIDS_FLOW_CONFIG;
  }
}

/**
 * Clears the cache, forcing the next call to fetch from Firestore.
 * Useful for admin updates.
 */
export async function clearKidsFlowConfigCache(): Promise<void> {
  cachedConfig = null;
  cacheTimestamp = 0;
}
