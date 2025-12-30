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
    const audio = new Audio();
    audio.src = audioUrl;
    audio.loop = true;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous'; // Required for Web Audio API

    const handleCanPlay = () => {
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
    if (!gainNodeRef.current || !audioContextRef.current || !isPlaying) return;

    const targetVolume = isSpeaking ? duckedVolume : normalVolume;
    const currentTime = audioContextRef.current.currentTime;

    // Smooth volume transition
    gainNodeRef.current.gain.cancelScheduledValues(currentTime);
    gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, currentTime);
    gainNodeRef.current.gain.linearRampToValueAtTime(
      targetVolume,
      currentTime + fadeDuration / 1000
    );
  }, [isSpeaking, normalVolume, duckedVolume, fadeDuration, isPlaying]);

  const play = useCallback(() => {
    if (!audioElementRef.current || !isLoaded) {
      console.warn('[useBackgroundMusic] Cannot play: audio not loaded');
      return;
    }

    // Create AudioContext on first play (browser autoplay policy requirement)
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext();
      } catch (e) {
        console.error('[useBackgroundMusic] Failed to create AudioContext:', e);
        // Fallback: play without Web Audio API (no ducking)
        audioElementRef.current.volume = normalVolume;
        audioElementRef.current.play()
          .then(() => setIsPlaying(true))
          .catch((error) => console.error('[useBackgroundMusic] Fallback play failed:', error));
        return;
      }
    }

    // Create gain node if not exists
    if (!gainNodeRef.current) {
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = normalVolume;
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }

    // Connect audio element to Web Audio API (only once per element)
    if (!isConnectedRef.current && audioElementRef.current) {
      try {
        sourceNodeRef.current = audioContextRef.current.createMediaElementSource(
          audioElementRef.current
        );
        sourceNodeRef.current.connect(gainNodeRef.current);
        isConnectedRef.current = true;
      } catch (e) {
        // May fail if already connected or CORS issue
        console.warn('[useBackgroundMusic] Could not connect to Web Audio API:', e);
      }
    }

    // Resume context if suspended (Safari requirement)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch((e) =>
        console.warn('[useBackgroundMusic] Failed to resume AudioContext:', e)
      );
    }

    // Set initial volume based on current TTS state
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isSpeaking ? duckedVolume : normalVolume;
    }

    audioElementRef.current.play()
      .then(() => setIsPlaying(true))
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
