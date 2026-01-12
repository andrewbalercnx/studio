'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { StoryOutputPage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { RotateCcw, BookOpen, Loader2, Play, Volume2, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { useResolvePlaceholdersMultiple } from '@/hooks/use-resolve-placeholders';

export type ReadMode = 'listen' | 'read';

export type ImmersivePlayerProps = {
  pages: StoryOutputPage[];
  bookTitle?: string;
  defaultReadMode?: ReadMode;
  onPlayAgain?: () => void;
  onExit?: () => void;
  onReadModeChange?: (mode: ReadMode) => void;
};

type PlayerState = 'waiting_for_interaction' | 'playing' | 'paused' | 'ended';

export function ImmersivePlayer({
  pages,
  bookTitle,
  defaultReadMode,
  onPlayAgain,
  onExit,
  onReadModeChange,
}: ImmersivePlayerProps) {
  // Filter to only pages with images (skip title_page, blank, etc.)
  const displayablePages = useMemo(
    () => pages.filter((p) => p.imageUrl),
    [pages]
  );

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [playerState, setPlayerState] = useState<PlayerState>('waiting_for_interaction');
  const [readMode, setReadMode] = useState<ReadMode | null>(defaultReadMode ?? null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Handle page changes and auto-play (only in 'listen' mode)
  useEffect(() => {
    if (playerState !== 'playing' || readMode !== 'listen') return;

    const cleanup = playCurrentPageAudio();
    return cleanup;
  }, [currentPageIndex, playerState, readMode, playCurrentPageAudio]);

  // Handle starting playback with a specific mode
  const handleStartWithMode = useCallback((mode: ReadMode) => {
    setReadMode(mode);
    setPlayerState('playing');
    onReadModeChange?.(mode);
  }, [onReadModeChange]);

  // Navigation for "Read Myself" mode
  const goToNextPage = useCallback(() => {
    if (hasNextPage) {
      setCurrentPageIndex(prev => prev + 1);
    } else {
      setPlayerState('ended');
    }
  }, [hasNextPage]);

  const goToPreviousPage = useCallback(() => {
    if (currentPageIndex > 0) {
      setCurrentPageIndex(prev => prev - 1);
    }
  }, [currentPageIndex]);

  // Handle tap/click - different behavior for listen vs read mode
  const handleScreenTap = useCallback(() => {
    if (playerState === 'ended' || playerState === 'waiting_for_interaction') return;

    if (readMode === 'read') {
      // In read mode, tap advances to next page (like pressing any key)
      goToNextPage();
      return;
    }

    // Listen mode - pause/resume behavior
    if (playerState === 'playing') {
      // Pause
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayerState('paused');
    } else {
      // Resume
      if (audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
      setPlayerState('playing');
    }
  }, [playerState, readMode, goToNextPage]);

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

  // Keyboard navigation for "Read Myself" mode
  useEffect(() => {
    if (readMode !== 'read' || playerState !== 'playing') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent default for navigation keys
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }

      // Left arrow or Up arrow goes to previous page
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        goToPreviousPage();
        return;
      }

      // Escape exits
      if (e.key === 'Escape') {
        handleExit();
        return;
      }

      // Any other key advances to next page
      goToNextPage();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readMode, playerState, goToNextPage, goToPreviousPage, handleExit]);

  // Render start screen - show reading mode options
  if (playerState === 'waiting_for_interaction') {
    return (
      <div
        className="fixed inset-0 bg-black select-none"
        style={{ zIndex: 9999 }}
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
        <div className="absolute inset-0 bg-black/40" />

        {/* Title and reading mode options */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 p-6">
          {bookTitle && (
            <h1 className="text-3xl sm:text-4xl font-headline text-white drop-shadow-lg text-center">
              {bookTitle}
            </h1>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Read to Me button */}
            <Button
              size="lg"
              className="min-w-[180px] h-auto py-4 px-6 text-lg bg-primary hover:bg-primary/90 shadow-2xl"
              onClick={(e) => {
                e.stopPropagation();
                handleStartWithMode('listen');
              }}
            >
              <Volume2 className="mr-3 h-6 w-6" />
              Read to Me
            </Button>

            {/* Read Myself button */}
            <Button
              size="lg"
              variant="secondary"
              className="min-w-[180px] h-auto py-4 px-6 text-lg bg-white/90 hover:bg-white text-foreground shadow-2xl"
              onClick={(e) => {
                e.stopPropagation();
                handleStartWithMode('read');
              }}
            >
              <Eye className="mr-3 h-6 w-6" />
              Read Myself
            </Button>
          </div>

          <p className="text-white/60 text-sm">Choose how you want to enjoy the story</p>
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

      {/* Loading indicator - only in listen mode */}
      {readMode === 'listen' && isAudioLoading && (
        <div className="absolute top-4 right-4">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        </div>
      )}

      {/* Page indicator */}
      <div className="absolute top-4 left-4 text-white/70 text-sm font-medium">
        {currentPageIndex + 1} / {totalPages}
      </div>

      {/* Exit button - top right (available in both modes) */}
      <button
        className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white/80 hover:text-white rounded-full p-2 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          handleExit();
        }}
        aria-label="Exit"
      >
        <BookOpen className="h-5 w-5" />
      </button>

      {/* Navigation buttons - available in both modes for manual navigation */}
      <>
        {/* Previous page button - left side */}
        {currentPageIndex > 0 && (
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white rounded-full p-3 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              // In listen mode, stop current audio before navigating
              if (readMode === 'listen' && audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
              }
              goToPreviousPage();
            }}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
        )}

        {/* Next page button - right side */}
        {hasNextPage && (
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white rounded-full p-3 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              // In listen mode, stop current audio before navigating
              if (readMode === 'listen' && audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
              }
              goToNextPage();
            }}
            aria-label="Next page"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        )}
      </>

      {/* Paused overlay with controls - only in listen mode */}
      {readMode === 'listen' && playerState === 'paused' && (
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

            {/* Body text - fades out on hover to reveal image underneath */}
            <div className="bg-black/50 backdrop-blur-sm rounded-2xl p-6 transition-opacity duration-300 hover:opacity-10">
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
          <p className="text-white/50 text-sm">
            {readMode === 'read'
              ? 'Tap or press any key to turn the page'
              : 'Tap anywhere to pause'
            }
          </p>
        </div>
      )}
    </div>
  );
}
