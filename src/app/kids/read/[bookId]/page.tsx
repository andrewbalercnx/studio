'use client';

import { use, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../../layout';
import type { Story, StoryOutputPage, StoryBookOutput } from '@/lib/types';
import { LoaderCircle, ChevronLeft, ChevronRight, Home, Play, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function KidsReadBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const resolvedParams = use(params);
  const bookId = resolvedParams.bookId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, isLocked } = useKidsPWA();

  // Check if this is the new model (storyId in query params)
  const storyIdParam = searchParams.get('storyId');
  const isNewModel = !!storyIdParam;
  const storyId = storyIdParam || bookId; // For new model, storyId is separate; for legacy, bookId IS the storyId

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load story
  const storyRef = useMemo(
    () => (firestore ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Load storybook (for new model - to get title override)
  const storybookRef = useMemo(
    () => (firestore && isNewModel ? doc(firestore, 'stories', storyId, 'storybooks', bookId) : null),
    [firestore, isNewModel, storyId, bookId]
  );
  const { data: storybook, loading: storybookLoading } = useDocument<StoryBookOutput>(storybookRef);

  // Load pages - different paths for legacy vs new model
  const pagesQuery = useMemo(() => {
    if (!firestore || !bookId) return null;

    if (isNewModel && storyId) {
      // New model: pages are in stories/{storyId}/storybooks/{storybookId}/pages
      return query(
        collection(firestore, 'stories', storyId, 'storybooks', bookId, 'pages'),
        orderBy('pageNumber', 'asc')
      );
    } else {
      // Legacy model: try stories/{bookId}/pages first (wizard flow)
      // Note: older legacy might use stories/{bookId}/outputs/storybook/pages
      // but we'll try the simpler path first
      return query(
        collection(firestore, 'stories', bookId, 'pages'),
        orderBy('pageNumber', 'asc')
      );
    }
  }, [firestore, isNewModel, storyId, bookId]);
  const { data: pages, loading: pagesLoading } = useCollection<StoryOutputPage>(pagesQuery);

  const currentPage = pages?.[currentPageIndex];
  const totalPages = pages?.length ?? 0;
  const hasNextPage = currentPageIndex < totalPages - 1;
  const hasPrevPage = currentPageIndex > 0;
  const currentPageHasAudio = currentPage?.audioStatus === 'ready' && currentPage?.audioUrl;

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

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

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(currentPage.audioUrl);
    audio.muted = isMuted;
    audioRef.current = audio;

    audio.ontimeupdate = () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    audio.onended = () => {
      setIsPlaying(false);
      setAudioProgress(100);
      // Auto-advance to next page after audio ends
      if (hasNextPage) {
        setTimeout(() => {
          setCurrentPageIndex((prev) => prev + 1);
        }, 1000);
      }
    };

    audio.onerror = () => {
      setIsPlaying(false);
    };

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch((err) => {
      console.error('[KidsRead] Failed to play audio:', err);
      setIsPlaying(false);
    });
  }, [currentPage?.audioUrl, isMuted, hasNextPage]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else if (currentPageHasAudio) {
      if (audioRef.current && audioProgress < 100) {
        audioRef.current.play();
        setIsPlaying(true);
      } else {
        playCurrentPageAudio();
      }
    }
  }, [isPlaying, currentPageHasAudio, audioProgress, playCurrentPageAudio]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      if (audioRef.current) {
        audioRef.current.muted = newMuted;
      }
      return newMuted;
    });
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
      setCurrentPageIndex((prev) => prev + 1);
    }
  }, [hasNextPage]);

  const goToPrevPage = useCallback(() => {
    if (hasPrevPage) {
      setCurrentPageIndex((prev) => prev - 1);
    }
  }, [hasPrevPage]);

  // Handle tap to show/hide controls
  const handleScreenTap = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  // Loading state
  const isLoading = userLoading || storyLoading || pagesLoading || (isNewModel && storybookLoading);
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Get title from storybook (new model) or story (legacy)
  const bookTitle = isNewModel ? (storybook?.title || story?.metadata?.title) : story?.metadata?.title;

  // No story or pages
  if (!story || !pages || pages.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-amber-50 to-orange-50 gap-4">
        <p className="text-amber-800">Book not found or still being created.</p>
        <Button asChild>
          <Link href="/kids/books">Go to My Books</Link>
        </Button>
      </div>
    );
  }

  // Security check: Verify story belongs to the current locked child
  if (story.childId !== childId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-amber-50 to-orange-50 gap-4">
        <p className="text-amber-800">This book belongs to someone else.</p>
        <Button asChild>
          <Link href="/kids/books">Go to My Books</Link>
        </Button>
      </div>
    );
  }

  const displayText = currentPage?.displayText || currentPage?.bodyText || '';
  const title = currentPage?.kind === 'cover_front' ? currentPage?.title : null;

  return (
    <div
      className="fixed inset-0 bg-black select-none"
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

      {/* Gradient overlay for text readability */}
      {displayText && (
        <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
      )}

      {/* Header controls - shown when controls visible */}
      <div
        className={cn(
          'absolute top-0 left-0 right-0 p-4 flex items-center justify-between transition-opacity duration-300 z-10',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <Link href="/kids/books" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="bg-white/20 hover:bg-white/30 text-white rounded-full"
          >
            <Home className="h-5 w-5" />
          </Button>
        </Link>
        <span className="text-white/80 text-sm font-medium">
          {currentPageIndex + 1} / {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="bg-white/20 hover:bg-white/30 text-white rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
        >
          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </Button>
      </div>

      {/* Navigation buttons - always visible on sides */}
      <div className="absolute inset-y-0 left-0 flex items-center z-10">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'ml-2 w-12 h-16 bg-white/10 hover:bg-white/20 text-white rounded-full transition-opacity',
            !hasPrevPage && 'opacity-30 pointer-events-none'
          )}
          onClick={(e) => {
            e.stopPropagation();
            goToPrevPage();
          }}
          disabled={!hasPrevPage}
        >
          <ChevronLeft className="h-8 w-8" />
        </Button>
      </div>
      <div className="absolute inset-y-0 right-0 flex items-center z-10">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'mr-2 w-12 h-16 bg-white/10 hover:bg-white/20 text-white rounded-full transition-opacity',
            !hasNextPage && 'opacity-30 pointer-events-none'
          )}
          onClick={(e) => {
            e.stopPropagation();
            goToNextPage();
          }}
          disabled={!hasNextPage}
        >
          <ChevronRight className="h-8 w-8" />
        </Button>
      </div>

      {/* Text content */}
      {(title || displayText) && (
        <div className="absolute bottom-0 left-0 right-0 p-6 pb-24 z-10">
          <div className="max-w-lg mx-auto">
            {title && (
              <h1 className="text-3xl font-bold text-white text-center mb-4 drop-shadow-lg">
                {title}
              </h1>
            )}
            {displayText && (
              <div className="bg-black/40 backdrop-blur-sm rounded-2xl p-5">
                <p className="text-xl text-white leading-relaxed text-center font-medium">
                  {displayText}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audio controls - bottom bar */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 p-4 transition-opacity duration-300 z-10',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Audio progress */}
        {currentPageHasAudio && (
          <Progress value={audioProgress} className="h-1 mb-4 bg-white/20" />
        )}

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="bg-white/20 hover:bg-white/30 text-white rounded-full"
            onClick={(e) => {
              e.stopPropagation();
              restartAudio();
            }}
            disabled={!currentPageHasAudio}
          >
            <RotateCcw className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="w-14 h-14 bg-amber-500 hover:bg-amber-600 text-white rounded-full"
            onClick={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            disabled={!currentPageHasAudio}
          >
            {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7 ml-1" />}
          </Button>

          {/* Page dots */}
          <div className="flex gap-1">
            {pages.slice(0, Math.min(7, totalPages)).map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  'w-2 h-2 rounded-full transition-all',
                  idx === currentPageIndex
                    ? 'bg-amber-500 w-4'
                    : idx < currentPageIndex
                      ? 'bg-white/60'
                      : 'bg-white/30'
                )}
              />
            ))}
            {totalPages > 7 && <span className="text-white/50 text-xs ml-1">+{totalPages - 7}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
