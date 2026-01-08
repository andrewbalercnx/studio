/**
 * Server-side helper to get ElevenLabs configuration from Firestore
 * Used by API routes and AI flows to get the current TTS model version
 */

import { getFirestore } from 'firebase-admin/firestore';
import type { DiagnosticsConfig, ElevenLabsApiVersion } from '@/lib/types';
import { DEFAULT_DIAGNOSTICS_CONFIG } from '@/lib/types';
import { ELEVENLABS_MODELS } from '@/lib/tts-config';

/**
 * Get the current ElevenLabs API version from system config
 * Returns the default (v2) if config doesn't exist or there's an error
 */
export async function getElevenLabsApiVersion(): Promise<ElevenLabsApiVersion> {
  try {
    const firestore = getFirestore();
    const configDoc = await firestore.doc('systemConfig/diagnostics').get();
    if (!configDoc.exists) return DEFAULT_DIAGNOSTICS_CONFIG.elevenLabsApiVersion;
    const config = configDoc.data() as DiagnosticsConfig;
    return config.elevenLabsApiVersion ?? DEFAULT_DIAGNOSTICS_CONFIG.elevenLabsApiVersion;
  } catch {
    return DEFAULT_DIAGNOSTICS_CONFIG.elevenLabsApiVersion;
  }
}

/**
 * Get the ElevenLabs model ID to use based on system config
 * Returns the model ID string (e.g., 'eleven_multilingual_v2' or 'eleven_v3')
 */
export async function getElevenLabsModelId(): Promise<string> {
  const version = await getElevenLabsApiVersion();
  return ELEVENLABS_MODELS[version];
}
