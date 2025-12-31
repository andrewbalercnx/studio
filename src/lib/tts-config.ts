/**
 * Shared TTS configuration - voices and types for ElevenLabs TTS
 */

/**
 * British voices - recommended for UK audiences
 * These appear first in the voice selector
 */
export const ELEVENLABS_BRITISH_VOICES = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', description: 'Warm, captivating storyteller, British', accent: 'british' as const, recommended: true },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Clear and engaging, friendly, British', accent: 'british' as const, recommended: true },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Steady broadcaster, British', accent: 'british' as const, recommended: true },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', description: 'Velvety actress, warm and clear, British', accent: 'british' as const, recommended: true },
] as const;

/**
 * Other ElevenLabs voices (primarily American accents)
 * These appear after British voices in the selector
 */
export const ELEVENLABS_OTHER_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Warm and calm, American', accent: 'american' as const, recommended: false },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: 'Soft and gentle, American', accent: 'american' as const, recommended: false },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', description: 'Young and friendly, American', accent: 'american' as const, recommended: false },
  { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Childlike and playful, American', accent: 'american' as const, recommended: false },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Expressive and warm, American', accent: 'american' as const, recommended: false },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep and engaging, American', accent: 'american' as const, recommended: false },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Strong and clear, American', accent: 'american' as const, recommended: false },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep and narrating, American', accent: 'american' as const, recommended: false },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', description: 'Calm narrator, American', accent: 'american' as const, recommended: false },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'British and pleasant', accent: 'british' as const, recommended: false },
] as const;

/**
 * All available ElevenLabs TTS voices combined
 * British voices first, then others
 * Using eleven_multilingual_v2 model for multi-language support (auto-detects language)
 */
export const ELEVENLABS_TTS_VOICES = [
  ...ELEVENLABS_BRITISH_VOICES,
  ...ELEVENLABS_OTHER_VOICES,
] as const;

// Keep old export name for backwards compatibility during migration
export const GEMINI_TTS_VOICES = ELEVENLABS_TTS_VOICES;

export type ElevenLabsVoiceId = typeof ELEVENLABS_TTS_VOICES[number]['id'];
export type GeminiVoiceId = ElevenLabsVoiceId; // Backwards compatibility

// Default voice - Alice is clear and engaging with a British accent
export const DEFAULT_TTS_VOICE = 'Xb7hH8MSUJpSbSDYk0k2'; // Alice (British)

// ElevenLabs model to use - multilingual_v2 auto-detects language from text
export const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

export type StoryAudioFlowInput = {
  storyId: string;
  forceRegenerate?: boolean;
  voiceConfig?: {
    voiceName?: string; // ElevenLabs voice ID
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
