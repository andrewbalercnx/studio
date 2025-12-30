/**
 * Shared TTS configuration - voices and types for ElevenLabs TTS
 */

/**
 * Available ElevenLabs TTS voices with their characteristics
 * These are optimized for different storytelling styles
 * Using eleven_multilingual_v2 model for language code support (en-GB)
 */
export const ELEVENLABS_TTS_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Warm and calm, American', recommended: true },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', description: 'Soft and gentle, American', recommended: true },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', description: 'Expressive and warm, American', recommended: false },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', description: 'Young and friendly, American', recommended: true },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Deep and engaging, American', recommended: false },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', description: 'Strong and clear, American', recommended: false },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep and narrating, American', recommended: false },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', description: 'Calm narrator, American', recommended: false },
  { id: 'jBpfuIE2acCO8z3wKNLl', name: 'Gigi', description: 'Childlike and playful, American', recommended: true },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy', description: 'British and pleasant', recommended: true },
] as const;

// Keep old export name for backwards compatibility during migration
export const GEMINI_TTS_VOICES = ELEVENLABS_TTS_VOICES;

export type ElevenLabsVoiceId = typeof ELEVENLABS_TTS_VOICES[number]['id'];
export type GeminiVoiceId = ElevenLabsVoiceId; // Backwards compatibility

// Default voice - Rachel is warm and calm, great for children's stories
export const DEFAULT_TTS_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel

// ElevenLabs model to use - multilingual_v2 supports language codes (en-GB)
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
