// ============================================================================
// TTS
// ============================================================================

/** Response from TTS endpoint. */
export type TTSResponse = {
  ok: boolean;
  audioUrl?: string;
  errorMessage?: string;
};

/** Request body for TTS endpoint */
export type TTSRequest = {
  text: string;
  voiceId?: string;
  childId?: string;
};
