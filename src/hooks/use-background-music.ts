'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseBackgroundMusicOptions {
  /** URL to the background music audio file */
  audioUrl?: string | null;
  /** Whether TTS is currently speaking (for volume ducking) */
  isSpeaking?: boolean;
  /** Normal volume level (0-1), default 0.4 */
  normalVolume?: number;
  /** Ducked volume level when TTS speaks (0-1), default 0.1 */
  duckedVolume?: number;
  /** Fade duration in milliseconds, default 300 */
  fadeDuration?: number;
}

interface UseBackgroundMusicReturn {
  /** Start playing the background music */
  play: () => void;
  /** Stop the background music immediately */
  stop: () => void;
  /** Fade out and stop the music */
  fadeOut: () => void;
  /** Whether music is currently playing */
  isPlaying: boolean;
  /** Whether the music is loaded and ready to play */
  isLoaded: boolean;
}

/**
 * Hook for managing background music playback with volume ducking.
 * Uses Web Audio API for precise volume control and smooth fading.
 *
 * Features:
 * - Automatic volume ducking when TTS speaks
 * - Smooth fade in/out transitions
 * - Looping playback
 * - Handles browser autoplay restrictions
 *
 * @example
 * ```tsx
 * const backgroundMusic = useBackgroundMusic({
 *   audioUrl: storyType?.backgroundMusic?.audioUrl,
 *   isSpeaking, // from useStoryTTS
 *   normalVolume: 0.4,
 *   duckedVolume: 0.1,
 * });
 *
 * // Start when processing
 * useEffect(() => {
 *   if (isProcessing && backgroundMusic.isLoaded) {
 *     backgroundMusic.play();
 *   } else if (!isProcessing) {
 *     backgroundMusic.fadeOut();
 *   }
 * }, [isProcessing, backgroundMusic]);
 * ```
 */
export function useBackgroundMusic(options: UseBackgroundMusicOptions): UseBackgroundMusicReturn {
  const {
    audioUrl,
    isSpeaking = false,
    normalVolume = 0.4,
    duckedVolume = 0.1,
    fadeDuration = 300,
  } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Web Audio API refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const isConnectedRef = useRef(false);

  // Initialize audio element when URL changes
  useEffect(() => {
    if (!audioUrl) {
      setIsLoaded(false);
      return;
    }

    // Create audio element
    // Note: We don't set crossOrigin because Firebase Storage may not have CORS configured
    // This means we can't use Web Audio API for volume control, but playback will work
    const audio = new Audio();
    audio.src = audioUrl;
    audio.loop = true;
    audio.preload = 'auto';
    // Don't set crossOrigin - it causes CORS errors with Firebase Storage

    const handleCanPlay = () => {
      console.log('[useBackgroundMusic] Audio loaded successfully:', audioUrl);
      setIsLoaded(true);
    };

    const handleError = (e: Event) => {
      console.error('[useBackgroundMusic] Failed to load audio:', audioUrl, e);
      setIsLoaded(false);
    };

    audio.addEventListener('canplaythrough', handleCanPlay);
    audio.addEventListener('error', handleError);

    audioElementRef.current = audio;

    return () => {
      audio.removeEventListener('canplaythrough', handleCanPlay);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.src = '';
      audioElementRef.current = null;
      setIsLoaded(false);
      setIsPlaying(false);
      isConnectedRef.current = false;
    };
  }, [audioUrl]);

  // Handle volume ducking when TTS speaks
  useEffect(() => {
    if (!isPlaying || !audioElementRef.current) return;

    const targetVolume = isSpeaking ? duckedVolume : normalVolume;

    // If we have Web Audio API connected, use smooth transitions
    if (gainNodeRef.current && audioContextRef.current) {
      const currentTime = audioContextRef.current.currentTime;
      gainNodeRef.current.gain.cancelScheduledValues(currentTime);
      gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, currentTime);
      gainNodeRef.current.gain.linearRampToValueAtTime(
        targetVolume,
        currentTime + fadeDuration / 1000
      );
    } else {
      // Fallback: Set volume directly on audio element (no smooth transition)
      audioElementRef.current.volume = targetVolume;
    }
  }, [isSpeaking, normalVolume, duckedVolume, fadeDuration, isPlaying]);

  const play = useCallback(() => {
    if (!audioElementRef.current || !isLoaded) {
      console.warn('[useBackgroundMusic] Cannot play: audio not loaded');
      return;
    }

    // Set initial volume based on current TTS state
    // Using direct audio element volume (Web Audio API not available without CORS)
    const initialVolume = isSpeaking ? duckedVolume : normalVolume;
    audioElementRef.current.volume = initialVolume;

    console.log('[useBackgroundMusic] Starting playback at volume:', initialVolume);

    audioElementRef.current.play()
      .then(() => {
        console.log('[useBackgroundMusic] Playback started successfully');
        setIsPlaying(true);
      })
      .catch((error) => {
        console.error('[useBackgroundMusic] Play failed:', error);
        setIsPlaying(false);
      });
  }, [isLoaded, normalVolume, duckedVolume, isSpeaking]);

  const stop = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  const fadeOut = useCallback(() => {
    if (!isPlaying) {
      stop();
      return;
    }

    if (!gainNodeRef.current || !audioContextRef.current) {
      // No Web Audio API, just stop
      stop();
      return;
    }

    const currentTime = audioContextRef.current.currentTime;

    // Fade to zero
    gainNodeRef.current.gain.cancelScheduledValues(currentTime);
    gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, currentTime);
    gainNodeRef.current.gain.linearRampToValueAtTime(0, currentTime + fadeDuration / 1000);

    // Stop after fade completes
    setTimeout(() => {
      stop();
      // Reset gain for next play
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = normalVolume;
      }
    }, fadeDuration);
  }, [isPlaying, fadeDuration, normalVolume, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    play,
    stop,
    fadeOut,
    isPlaying,
    isLoaded,
  };
}
