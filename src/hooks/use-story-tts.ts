'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useTTS } from './use-tts';
import type { ChildProfile } from '@/lib/types';

// Option labels for TTS (A, B, C, D, etc.)
const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface UseStoryTTSOptions {
  /** The child profile (used to check autoReadAloud and get voice) */
  childProfile: ChildProfile | null;
  /** Called when TTS encounters an error */
  onError?: (error: string) => void;
}

interface UseStoryTTSReturn {
  /** Whether speech mode is enabled for this child */
  isSpeechModeEnabled: boolean;
  /** Whether TTS is currently speaking */
  isSpeaking: boolean;
  /** Whether TTS is loading/generating audio */
  isLoading: boolean;
  /** Speak story content (header text, question, and options) */
  speakStoryContent: (content: {
    headerText?: string;
    questionText?: string;
    options?: Array<{ text: string }>;
  }) => void;
  /** Stop any current speech */
  stopSpeech: () => void;
}

/**
 * Hook for managing TTS in the story creation flow.
 * Automatically formats options as "Option A: ..., Option B: ..." etc.
 */
export function useStoryTTS(options: UseStoryTTSOptions): UseStoryTTSReturn {
  const { childProfile, onError } = options;

  // Check if speech mode is enabled (requires both preferredVoiceId and autoReadAloud)
  const isSpeechModeEnabled = !!(
    childProfile?.preferredVoiceId && childProfile?.autoReadAloud
  );

  const tts = useTTS({
    childId: childProfile?.id,
    voiceId: childProfile?.preferredVoiceId,
    onError,
  });

  // Track content that has been spoken to avoid repeating
  const lastSpokenContentRef = useRef<string>('');

  // Store stop function in ref to avoid effect dependency issues
  const stopRef = useRef(tts.stop);
  stopRef.current = tts.stop;

  /**
   * Build the full text to speak from story content.
   * Format: "[headerText]. [questionText]. Option A: [text]. Option B: [text]..."
   */
  const buildSpeechText = useCallback((content: {
    headerText?: string;
    questionText?: string;
    options?: Array<{ text: string }>;
  }): string => {
    const parts: string[] = [];

    // Add header text if present
    if (content.headerText?.trim()) {
      parts.push(content.headerText.trim());
    }

    // Add question text if present
    if (content.questionText?.trim()) {
      parts.push(content.questionText.trim());
    }

    // Add options with labels
    if (content.options && content.options.length > 0) {
      const optionTexts = content.options
        .filter(opt => opt.text?.trim() && !(opt as any).isMoreOption) // Skip "more" options
        .map((opt, idx) => {
          const label = OPTION_LABELS[idx] || `${idx + 1}`;
          return `Option ${label}: ${opt.text.trim()}`;
        });

      if (optionTexts.length > 0) {
        parts.push(optionTexts.join('. '));
      }
    }

    return parts.join('. ');
  }, []);

  const speakStoryContent = useCallback((content: {
    headerText?: string;
    questionText?: string;
    options?: Array<{ text: string }>;
  }) => {
    console.log('[useStoryTTS] speakStoryContent called:', {
      isSpeechModeEnabled,
      hasHeaderText: !!content.headerText,
      hasQuestionText: !!content.questionText,
      optionsCount: content.options?.length,
    });

    if (!isSpeechModeEnabled) {
      console.log('[useStoryTTS] Speech mode not enabled, skipping');
      return;
    }

    const textToSpeak = buildSpeechText(content);
    console.log('[useStoryTTS] Built text to speak:', textToSpeak?.substring(0, 100));

    // Don't speak if empty or same as last spoken
    if (!textToSpeak || textToSpeak === lastSpokenContentRef.current) {
      console.log('[useStoryTTS] Skipping - empty or same as last:', {
        isEmpty: !textToSpeak,
        isSameAsLast: textToSpeak === lastSpokenContentRef.current,
      });
      return;
    }

    console.log('[useStoryTTS] Calling tts.speak()');
    lastSpokenContentRef.current = textToSpeak;
    tts.speak(textToSpeak);
  }, [isSpeechModeEnabled, buildSpeechText, tts]);

  const stopSpeech = useCallback(() => {
    tts.stop();
  }, [tts]);

  // Stop speech when component unmounts or speech mode is disabled
  useEffect(() => {
    if (!isSpeechModeEnabled) {
      stopRef.current();
    }
    return () => {
      stopRef.current();
    };
  }, [isSpeechModeEnabled]);

  return {
    isSpeechModeEnabled,
    isSpeaking: tts.isSpeaking,
    isLoading: tts.isLoading,
    speakStoryContent,
    stopSpeech,
  };
}
