'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useUser } from '@/firebase/auth/use-user';

interface UseTTSOptions {
  /** Child ID to look up preferred voice */
  childId?: string;
  /** Specific voice ID to use (overrides child's preferred voice) */
  voiceId?: string;
  /** Called when speech starts */
  onStart?: () => void;
  /** Called when speech ends */
  onEnd?: () => void;
  /** Called on error */
  onError?: (error: string) => void;
}

interface UseTTSReturn {
  /** Speak the given text using TTS */
  speak: (text: string) => Promise<void>;
  /** Stop any current speech */
  stop: () => void;
  /** Whether currently speaking */
  isSpeaking: boolean;
  /** Whether TTS is loading/generating */
  isLoading: boolean;
  /** Whether there's queued audio waiting for user gesture */
  hasQueuedAudio: boolean;
  /** Resume queued audio (call after user gesture) */
  resumeQueuedAudio: () => void;
}

/**
 * Hook for text-to-speech using ElevenLabs API.
 * Handles authentication, audio playback, and state management.
 */
export function useTTS(options: UseTTSOptions = {}): UseTTSReturn {
  const { childId, voiceId, onStart, onEnd, onError } = options;
  const { user } = useUser();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasQueuedAudio, setHasQueuedAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentTextRef = useRef<string | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const queuedAudioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    // Abort any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    // Clear queued audio
    if (queuedAudioRef.current) {
      queuedAudioRef.current = null;
      setHasQueuedAudio(false);
    }

    // Clear text tracking
    currentTextRef.current = null;
    pendingTextRef.current = null;

    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  // Resume queued audio after user gesture
  const resumeQueuedAudio = useCallback(async () => {
    if (!queuedAudioRef.current) {
      console.log('[useTTS] resumeQueuedAudio: no queued audio');
      return;
    }

    const audio = queuedAudioRef.current;
    queuedAudioRef.current = null;
    setHasQueuedAudio(false);

    try {
      console.log('[useTTS] Resuming queued audio after user gesture...');
      setIsSpeaking(true);
      onStart?.();
      await audio.play();
      console.log('[useTTS] Queued audio playback started');
      audioRef.current = audio;
    } catch (error: any) {
      console.error('[useTTS] Failed to resume queued audio:', error);
      setIsSpeaking(false);
      // Don't report error - user can try again
    }
  }, [onStart]);

  const speak = useCallback(async (text: string) => {
    console.log('[useTTS] speak() called:', { hasUser: !!user, textLength: text.length, voiceId, childId });

    if (!user) {
      console.log('[useTTS] No user, aborting');
      onError?.('Not authenticated');
      return;
    }

    if (!text.trim()) {
      console.log('[useTTS] Empty text, aborting');
      return;
    }

    // Skip if this is the same text we're already speaking or loading
    if (text === currentTextRef.current || text === pendingTextRef.current) {
      console.log('[useTTS] Same text already in progress, skipping');
      return;
    }

    // Stop any current speech
    stop();

    // Track what we're about to speak
    pendingTextRef.current = text;

    setIsLoading(true);

    try {
      // Create abort controller for this request
      // Store in local variable to avoid race condition if stop() is called
      // during async operations (getIdToken) which would null the ref
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Get fresh ID token
      console.log('[useTTS] Getting ID token...');
      const idToken = await user.getIdToken();
      console.log('[useTTS] Got ID token, calling /api/tts...');

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          text,
          voiceId,
          childId,
        }),
        signal: controller.signal,
      });

      console.log('[useTTS] Response status:', response.status);
      const result = await response.json();
      console.log('[useTTS] Response result:', { ok: result.ok, hasAudioData: !!result.audioData, errorMessage: result.errorMessage });

      if (!result.ok) {
        throw new Error(result.errorMessage || 'TTS request failed');
      }

      // Create audio from base64 data
      const audioSrc = `data:${result.mimeType};base64,${result.audioData}`;
      const audio = new Audio(audioSrc);
      audioRef.current = audio;

      audio.onended = () => {
        console.log('[useTTS] Audio playback ended');
        setIsSpeaking(false);
        audioRef.current = null;
        currentTextRef.current = null;
        onEnd?.();
      };

      audio.onerror = (e) => {
        console.error('[useTTS] Audio playback error:', e);
        setIsSpeaking(false);
        audioRef.current = null;
        currentTextRef.current = null;
        onError?.('Audio playback failed');
      };

      setIsLoading(false);
      setIsSpeaking(true);
      currentTextRef.current = text;
      pendingTextRef.current = null;
      onStart?.();

      console.log('[useTTS] Starting audio playback...');
      await audio.play();
      console.log('[useTTS] Audio playback started successfully');
    } catch (error: any) {
      setIsLoading(false);
      setIsSpeaking(false);
      pendingTextRef.current = null;

      // Don't report abort errors
      if (error.name === 'AbortError') {
        console.log('[useTTS] Request aborted');
        return;
      }

      // Handle browser autoplay restrictions gracefully
      // This happens when audio.play() is called without a user gesture
      if (error.name === 'NotAllowedError') {
        console.log('[useTTS] Autoplay blocked by browser - queuing audio for user gesture');
        // Queue the audio so it can be played after a user gesture
        if (audioRef.current) {
          queuedAudioRef.current = audioRef.current;
          audioRef.current = null;
          setHasQueuedAudio(true);
          // Keep the text tracking so we know what's queued
          currentTextRef.current = text;
        }
        return;
      }

      console.error('[useTTS] Error:', error);
      onError?.(error.message || 'Failed to generate speech');
    }
  }, [user, childId, voiceId, onStart, onEnd, onError, stop]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      // Abort any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Stop audio playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // Clear queued audio
      if (queuedAudioRef.current) {
        queuedAudioRef.current = null;
      }
    };
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    isLoading,
    hasQueuedAudio,
    resumeQueuedAudio,
  };
}
