'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { StoryOutputPage } from '@/lib/types';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Loader2,
  Mic,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';

export type BookReaderProps = {
  pages: StoryOutputPage[];
  bookTitle?: string;
  onGeneratePageAudio?: (pageId: string) => Promise<void>;
  onGenerateAllAudio?: () => Promise<void>;
  isGeneratingAudio?: boolean;
};

export function BookReader({
  pages,
  bookTitle,
  onGeneratePageAudio,
  onGenerateAllAudio,
  isGeneratingAudio = false,
}: BookReaderProps) {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentPage = pages[currentPageIndex];
  const totalPages = pages.length;
  const hasNextPage = currentPageIndex < totalPages - 1;
  const hasPrevPage = currentPageIndex > 0;

  // Audio status helpers
  const currentPageHasAudio = currentPage?.audioStatus === 'ready' && currentPage?.audioUrl;
  const currentPageAudioGenerating = currentPage?.audioStatus === 'generating';
  const allPagesHaveAudio = pages.every(p => p.audioStatus === 'ready');
  const anyPageGeneratingAudio = pages.some(p => p.audioStatus === 'generating');

  // Calculate overall audio progress
  const pagesWithAudio = pages.filter(p => p.audioStatus === 'ready' && p.audioUrl).length;
  const audioGenerationProgress = totalPages > 0 ? (pagesWithAudio / totalPages) * 100 : 0;

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Handle page change - stop current audio
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setAudioProgress(0);
  }, [currentPageIndex]);

  // Play audio for current page
  const playCurrentPageAudio = useCallback(() => {
    if (!currentPage?.audioUrl) return;

    // Stop any existing audio
    if (audioRef.current) {
      audioRef.current.pause();
    }

    console.log('[BookReader] Playing audio from URL:', currentPage.audioUrl?.substring(0, 100) + '...');

    let audio: HTMLAudioElement;
    try {
      audio = new Audio(currentPage.audioUrl);
    } catch (err) {
      console.error('[BookReader] Failed to create Audio element with URL:', currentPage.audioUrl?.substring(0, 100), err);
      setIsPlaying(false);
      return;
    }

    audio.muted = isMuted;
    audioRef.current = audio;

    // Update progress during playback
    audio.ontimeupdate = () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    // Handle audio end
    audio.onended = () => {
      setIsPlaying(false);
      setAudioProgress(100);

      // In auto mode, advance to next page after a short delay
      if (autoMode && hasNextPage) {
        setTimeout(() => {
          setCurrentPageIndex(prev => prev + 1);
        }, 1000); // 1 second pause between pages
      }
    };

    audio.onerror = (e) => {
      console.error('[BookReader] Audio playback error for URL:', currentPage.audioUrl?.substring(0, 100), e);
      setIsPlaying(false);
    };

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch(err => {
      console.error('[BookReader] Failed to play audio:', err, 'URL:', currentPage.audioUrl?.substring(0, 100));
      setIsPlaying(false);
    });
  }, [currentPage?.audioUrl, isMuted, autoMode, hasNextPage]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else if (currentPageHasAudio) {
      if (audioRef.current && audioProgress < 100) {
        // Resume existing audio
        audioRef.current.play();
        setIsPlaying(true);
      } else {
        // Start fresh
        playCurrentPageAudio();
      }
    }
  }, [isPlaying, currentPageHasAudio, audioProgress, playCurrentPageAudio]);

  // Auto-play when entering auto mode or changing pages in auto mode
  useEffect(() => {
    if (autoMode && currentPageHasAudio && !isPlaying) {
      playCurrentPageAudio();
    }
  }, [autoMode, currentPageIndex, currentPageHasAudio, isPlaying, playCurrentPageAudio]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev;
      if (audioRef.current) {
        audioRef.current.muted = newMuted;
      }
      return newMuted;
    });
  }, []);

  // Toggle auto mode
  const toggleAutoMode = useCallback(() => {
    setAutoMode(prev => !prev);
  }, []);

  // Restart audio
  const restartAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      setIsPlaying(true);
    } else if (currentPageHasAudio) {
      playCurrentPageAudio();
    }
  }, [currentPageHasAudio, playCurrentPageAudio]);

  // Navigation
  const goToNextPage = useCallback(() => {
    if (hasNextPage) {
      setCurrentPageIndex(prev => prev + 1);
    }
  }, [hasNextPage]);

  const goToPrevPage = useCallback(() => {
    if (hasPrevPage) {
      setCurrentPageIndex(prev => prev - 1);
    }
  }, [hasPrevPage]);

  // Handle generate audio for current page
  const handleGenerateCurrentPageAudio = useCallback(async () => {
    if (currentPage?.id && onGeneratePageAudio) {
      await onGeneratePageAudio(currentPage.id);
    }
  }, [currentPage?.id, onGeneratePageAudio]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        if (e.key === ' ') {
          togglePlayPause();
        } else {
          goToNextPage();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevPage();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        toggleAutoMode();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, goToNextPage, goToPrevPage, toggleAutoMode, toggleMute]);

  if (!currentPage) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        No pages available
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      {/* Header with title and progress */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold truncate max-w-[200px] sm:max-w-none">
            {bookTitle || 'Storybook'}
          </h2>
          {autoMode && (
            <Badge variant="secondary" className="text-xs">
              Auto
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Page {currentPageIndex + 1} of {totalPages}
          </span>
        </div>
      </div>

      {/* Main content area - image and text */}
      <div className="flex-1 overflow-hidden relative">
        {/* Image */}
        <div className="relative h-[50vh] sm:h-[60vh] bg-muted/30">
          {currentPage.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentPage.imageUrl}
              alt={currentPage.imagePrompt || `Page ${currentPage.pageNumber + 1}`}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <span>Image not available</span>
            </div>
          )}

          {/* Page type badge */}
          <div className="absolute top-4 left-4">
            <Badge variant="secondary" className="capitalize text-xs">
              {currentPage.kind.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>

        {/* Text content */}
        <div className="p-6 bg-background">
          {currentPage.title && (
            <h3 className="text-2xl font-bold mb-3 text-center">
              {currentPage.title}
            </h3>
          )}
          {(currentPage.displayText || currentPage.bodyText) && (
            <p className="text-lg leading-relaxed text-center max-w-2xl mx-auto">
              {currentPage.displayText || currentPage.bodyText}
            </p>
          )}
        </div>
      </div>

      {/* Audio progress bar */}
      {currentPageHasAudio && (
        <div className="px-4 py-2 bg-muted/30">
          <Progress value={audioProgress} className="h-1" />
        </div>
      )}

      {/* Audio generation progress */}
      {!allPagesHaveAudio && (
        <div className="px-4 py-2 bg-primary/5 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {anyPageGeneratingAudio || isGeneratingAudio
                ? 'Generating audio...'
                : `${pagesWithAudio}/${totalPages} pages have audio`}
            </span>
            {onGenerateAllAudio && !allPagesHaveAudio && (
              <Button
                variant="outline"
                size="sm"
                onClick={onGenerateAllAudio}
                disabled={isGeneratingAudio || anyPageGeneratingAudio}
              >
                {isGeneratingAudio || anyPageGeneratingAudio ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 h-3 w-3" />
                    Generate All Audio
                  </>
                )}
              </Button>
            )}
          </div>
          <Progress value={audioGenerationProgress} className="h-1 mt-2" />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-4 border-t bg-background/95 backdrop-blur">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPrevPage}
            disabled={!hasPrevPage}
            title="Previous page (Left arrow)"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={goToNextPage}
            disabled={!hasNextPage}
            title="Next page (Right arrow)"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* Playback controls */}
        <div className="flex items-center gap-2">
          {/* Generate audio button for current page */}
          {!currentPageHasAudio && !currentPageAudioGenerating && onGeneratePageAudio && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleGenerateCurrentPageAudio}
              disabled={isGeneratingAudio}
              title="Generate audio for this page"
            >
              <Mic className="h-5 w-5" />
            </Button>
          )}

          {/* Loading indicator for current page */}
          {currentPageAudioGenerating && (
            <Button variant="ghost" size="icon" disabled>
              <Loader2 className="h-5 w-5 animate-spin" />
            </Button>
          )}

          {/* Play/Pause */}
          <Button
            variant={autoMode ? 'default' : 'outline'}
            size="icon"
            onClick={togglePlayPause}
            disabled={!currentPageHasAudio}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </Button>

          {/* Restart */}
          <Button
            variant="ghost"
            size="icon"
            onClick={restartAudio}
            disabled={!currentPageHasAudio}
            title="Restart audio"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>

          {/* Mute toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {isMuted ? (
              <VolumeX className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Auto mode toggle */}
        <Button
          variant={autoMode ? 'default' : 'outline'}
          size="sm"
          onClick={toggleAutoMode}
          title="Auto-advance mode (A)"
          className={clsx(
            autoMode && 'bg-primary text-primary-foreground'
          )}
        >
          {autoMode ? 'Auto: On' : 'Auto: Off'}
        </Button>
      </div>

      {/* Page thumbnails */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto border-t bg-muted/30">
        {pages.map((page, idx) => (
          <button
            key={page.id || idx}
            onClick={() => setCurrentPageIndex(idx)}
            className={clsx(
              'flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all',
              idx === currentPageIndex
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-transparent hover:border-primary/50'
            )}
          >
            {page.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.imageUrl}
                alt={`Page ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
                {idx + 1}
              </div>
            )}
            {/* Audio indicator */}
            {page.audioStatus === 'ready' && page.audioUrl && (
              <div className="absolute bottom-0 right-0 p-0.5 bg-green-500 rounded-tl">
                <Volume2 className="h-2 w-2 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
