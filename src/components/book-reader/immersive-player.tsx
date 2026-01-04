'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { StoryOutputPage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { RotateCcw, BookOpen, Loader2, Play } from 'lucide-react';
import clsx from 'clsx';
import { useResolvePlaceholdersMultiple } from '@/hooks/use-resolve-placeholders';

export type ImmersivePlayerProps = {
  pages: StoryOutputPage[];
  bookTitle?: string;
  onPlayAgain?: () => void;
  onExit?: () => void;
};

type PlayerState = 'waiting_for_interaction' | 'playing' | 'paused' | 'ended';

export function ImmersivePlayer({
  pages,
  bookTitle,
  onPlayAgain,
  onExit,
}: ImmersivePlayerProps) {
  // Filter to only pages with images (skip title_page, blank, etc.)
  const displayablePages = useMemo(
    () => pages.filter((p) => p.imageUrl),
    [pages]
  );

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [playerState, setPlayerState] = useState<PlayerState>('waiting_for_interaction');
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const currentPage = displayablePages[currentPageIndex];
  const totalPages = displayablePages.length;
  const hasNextPage = currentPageIndex < totalPages - 1;

  // Collect all page texts that may need placeholder resolution
  // This resolves placeholders client-side as a fallback for pages that weren't
  // processed with the newer storyPageFlow that pre-resolves displayText
  const pageTexts = useMemo(
    () => displayablePages.map((p) => p.displayText || p.bodyText || p.title || null),
    [displayablePages]
  );
  const { resolvedTexts } = useResolvePlaceholdersMultiple(pageTexts);

  // Get text to display - use resolved text if available
  const displayText = resolvedTexts[currentPageIndex] || currentPage?.displayText || currentPage?.bodyText || currentPage?.title || '';

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Pause duration for pages without audio (10 seconds)
  const NO_AUDIO_PAUSE_MS = 10000;

  // Play audio for current page
  const playCurrentPageAudio = useCallback(() => {
    if (!currentPage?.audioUrl) {
      // No audio for this page, pause for 10 seconds then auto-advance
      console.log(`[ImmersivePlayer] No audio for page ${currentPageIndex + 1}, pausing for ${NO_AUDIO_PAUSE_MS / 1000}s`);

      const timeout = setTimeout(() => {
        if (hasNextPage) {
          setCurrentPageIndex(prev => prev + 1);
        } else {
          setPlayerState('ended');
        }
      }, NO_AUDIO_PAUSE_MS);

      return () => clearTimeout(timeout);
    }

    // Stop any existing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setIsAudioLoading(true);

    const audio = new Audio(currentPage.audioUrl);
    audioRef.current = audio;

    audio.oncanplaythrough = () => {
      setIsAudioLoading(false);
    };

    audio.onended = () => {
      if (hasNextPage) {
        // Short delay before advancing
        setTimeout(() => {
          setCurrentPageIndex(prev => prev + 1);
        }, 500);
      } else {
        setPlayerState('ended');
      }
    };

    audio.onerror = () => {
      console.error(`[ImmersivePlayer] Audio failed to load for page ${currentPageIndex + 1}, pausing for ${NO_AUDIO_PAUSE_MS / 1000}s`);
      setIsAudioLoading(false);
      // Auto-advance after 10 second pause on error
      setTimeout(() => {
        if (hasNextPage) {
          setCurrentPageIndex(prev => prev + 1);
        } else {
          setPlayerState('ended');
        }
      }, NO_AUDIO_PAUSE_MS);
    };

    audio.play().catch(err => {
      // AbortError happens when audio is interrupted (e.g., page change) - ignore it
      if (err.name === 'AbortError') {
        return;
      }
      console.error('[ImmersivePlayer] Failed to play audio:', err);
      setIsAudioLoading(false);
    });

    return undefined;
  }, [currentPage?.audioUrl, currentPageIndex, hasNextPage]);

  // Handle page changes and auto-play
  useEffect(() => {
    if (playerState !== 'playing') return;

    const cleanup = playCurrentPageAudio();
    return cleanup;
  }, [currentPageIndex, playerState, playCurrentPageAudio]);

  // Handle starting playback (requires user interaction for audio)
  const handleStartPlayback = useCallback(() => {
    setPlayerState('playing');
  }, []);

  // Handle tap/click to pause/resume
  const handleScreenTap = useCallback(() => {
    if (playerState === 'ended' || playerState === 'waiting_for_interaction') return;

    if (playerState === 'playing') {
      // Pause
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayerState('paused');
      setShowControls(true);
    } else {
      // Resume
      if (audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
      setPlayerState('playing');
      // Hide controls after a delay
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    }
  }, [playerState]);

  // Handle play again
  const handlePlayAgain = useCallback(() => {
    setCurrentPageIndex(0);
    setPlayerState('playing');
    if (onPlayAgain) {
      onPlayAgain();
    }
  }, [onPlayAgain]);

  // Handle exit
  const handleExit = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (onExit) {
      onExit();
    }
  }, [onExit]);

  // Render start screen - requires user tap to enable audio playback
  if (playerState === 'waiting_for_interaction') {
    return (
      <div
        className="fixed inset-0 bg-black cursor-pointer select-none"
        style={{ zIndex: 9999 }}
        onClick={handleStartPlayback}
      >
        {/* Background image - show cover */}
        {currentPage?.imageUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage: `url(${currentPage.imageUrl})`,
            }}
          />
        )}

        {/* Slight overlay for contrast */}
        <div className="absolute inset-0 bg-black/30" />

        {/* Center play button */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
          <div className="bg-white/90 rounded-full p-8 shadow-2xl">
            <Play className="h-20 w-20 text-primary fill-primary" />
          </div>
          <div className="text-center space-y-2">
            {bookTitle && (
              <h1 className="text-3xl sm:text-4xl font-headline text-white drop-shadow-lg">
                {bookTitle}
              </h1>
            )}
            <p className="text-white/80 text-lg">Tap to start</p>
          </div>
        </div>
      </div>
    );
  }

  // Render end screen
  if (playerState === 'ended') {
    return (
      <div
        className="fixed inset-0 bg-gradient-to-b from-primary/20 to-background flex flex-col items-center justify-center gap-8 p-6"
        style={{ zIndex: 9999 }}
      >
        <div className="text-center space-y-4">
          <BookOpen className="h-16 w-16 mx-auto text-primary" />
          <h2 className="text-3xl font-headline">The End</h2>
          {bookTitle && (
            <p className="text-lg text-muted-foreground">{bookTitle}</p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <Button
            size="lg"
            onClick={handlePlayAgain}
            className="min-w-[200px]"
          >
            <RotateCcw className="mr-2 h-5 w-5" />
            Play Again
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={handleExit}
            className="min-w-[200px]"
          >
            <BookOpen className="mr-2 h-5 w-5" />
            Back to My Books
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black cursor-pointer select-none"
      style={{ zIndex: 9999 }}
      onClick={handleScreenTap}
    >
      {/* Background image */}
      {currentPage?.imageUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
          style={{
            backgroundImage: `url(${currentPage.imageUrl})`,
          }}
        />
      )}

      {/* Gradient overlay for text readability - only covers bottom portion */}
      <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

      {/* Loading indicator */}
      {isAudioLoading && (
        <div className="absolute top-4 right-4">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        </div>
      )}

      {/* Page indicator */}
      <div className="absolute top-4 left-4 text-white/70 text-sm font-medium">
        {currentPageIndex + 1} / {totalPages}
      </div>

      {/* Paused overlay with controls */}
      {playerState === 'paused' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-black/40">
          {/* Continue play button */}
          <div className="bg-white/90 rounded-full p-6 shadow-2xl">
            <Play className="h-16 w-16 text-primary fill-primary" />
          </div>
          <p className="text-white text-lg">Tap anywhere to continue</p>

          {/* Return button - stops event propagation to prevent resuming */}
          <Button
            variant="outline"
            size="lg"
            className="bg-white/90 hover:bg-white text-foreground border-0 shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
              handleExit();
            }}
          >
            <BookOpen className="mr-2 h-5 w-5" />
            Return to My Books
          </Button>
        </div>
      )}

      {/* Text content */}
      {displayText && (
        <div className="absolute bottom-0 left-0 right-0 p-6 pb-safe">
          <div className="max-w-3xl mx-auto">
            {/* Title on first page or cover pages */}
            {(currentPage?.kind === 'cover_front' || currentPage?.kind === 'cover_back') && currentPage?.title && (
              <h1 className="text-3xl sm:text-4xl font-headline text-white text-center mb-4 drop-shadow-lg">
                {currentPage.title}
              </h1>
            )}

            {/* Body text */}
            <div className="bg-black/50 backdrop-blur-sm rounded-2xl p-6">
              <p className="text-xl sm:text-2xl text-white leading-relaxed text-center font-medium">
                {displayText}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Progress dots */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
        {displayablePages.map((_, idx) => (
          <div
            key={idx}
            className={clsx(
              "w-2 h-2 rounded-full transition-all duration-300",
              idx === currentPageIndex
                ? "bg-white w-4"
                : idx < currentPageIndex
                ? "bg-white/70"
                : "bg-white/30"
            )}
          />
        ))}
      </div>

      {/* Tap hint - show briefly on first load */}
      {playerState === 'playing' && currentPageIndex === 0 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 animate-pulse">
          <p className="text-white/50 text-sm">Tap anywhere to pause</p>
        </div>
      )}
    </div>
  );
}
