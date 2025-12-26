/**
 * Shared TTS configuration - voices and types for Gemini TTS
 */

/**
 * Available Gemini TTS voices with their characteristics
 * These are optimized for different storytelling styles
 */
export const GEMINI_TTS_VOICES = [
  { id: 'Puck', name: 'Puck', description: 'Upbeat and playful', recommended: true },
  { id: 'Charon', name: 'Charon', description: 'Calm and soothing', recommended: false },
  { id: 'Kore', name: 'Kore', description: 'Warm and friendly', recommended: true },
  { id: 'Fenrir', name: 'Fenrir', description: 'Strong and confident', recommended: false },
  { id: 'Aoede', name: 'Aoede', description: 'Gentle and melodic', recommended: true },
  { id: 'Leda', name: 'Leda', description: 'Bright and cheerful', recommended: false },
  { id: 'Orus', name: 'Orus', description: 'Deep and resonant', recommended: false },
  { id: 'Zephyr', name: 'Zephyr', description: 'Light and airy', recommended: false },
  { id: 'Callirrhoe', name: 'Callirrhoe', description: 'Expressive storyteller', recommended: false },
  { id: 'Autonoe', name: 'Autonoe', description: 'Nurturing and kind', recommended: false },
] as const;

export type GeminiVoiceId = typeof GEMINI_TTS_VOICES[number]['id'];

// Default voice - Kore is warm and friendly, great for children's stories
export const DEFAULT_TTS_VOICE = 'Kore';

export type StoryAudioFlowInput = {
  storyId: string;
  forceRegenerate?: boolean;
  voiceConfig?: {
    voiceName?: string; // Gemini voice: Puck, Charon, Kore, Fenrir, Aoede, etc.
  };
};

export type StoryAudioFlowOutput = {
  ok: boolean;
  audioUrl?: string;
  audioMetadata?: {
    storagePath: string;
    downloadToken: string;
    durationSeconds?: number;
    voiceId: string;
    sizeBytes: number;
  };
  errorMessage?: string;
};
