'use client';

import { use, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useKidsPWA } from '../../../layout';
import { useRequiredApiClient } from '@/contexts/api-client-context';
import type { Story } from '@/lib/types';
import { LoaderCircle, ArrowLeft, Volume2, VolumeX, BookOpen, Sparkles, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

// Actor type returned by the API (different from the base Story.actors which is string[])
type Actor = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  type: 'child' | 'character';
};

// Storybook type as returned by the API (with additional resolved fields)
type Storybook = {
  id: string;
  storyId: string;
  thumbnailUrl?: string;
  imageStyleName?: string;
  outputTypeName?: string;
  imageGeneration?: { status: string };
};

// Extended story type with resolved fields from API
type StoryWithResolved = Omit<Story, 'actors'> & {
  titleResolved?: string;
  synopsisResolved?: string;
  storyTextResolved?: string;
  actors?: Actor[];
};

export default function KidsStoryReadPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const resolvedParams = use(params);
  const { storyId } = resolvedParams;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked } = useKidsPWA();

  // API client for data fetching
  const apiClient = useRequiredApiClient();

  // State
  const [story, setStory] = useState<StoryWithResolved | null>(null);
  const [storybooks, setStorybooks] = useState<Storybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load story and storybooks via API
  useEffect(() => {
    if (!apiClient || !storyId) return;

    setLoading(true);
    setError(null);

    Promise.all([
      apiClient.getStory(storyId),
      apiClient.getMyStorybooks(storyId).catch(() => []),
    ])
      .then(([storyData, storybooksData]) => {
        setStory(storyData as StoryWithResolved);
        setStorybooks(storybooksData);
      })
      .catch((err) => {
        console.error('[KidsStoryRead] Error loading story:', err);
        setError(err.message || 'Failed to load story');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiClient, storyId]);

  // Stop current audio playback
  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    speechSynthesis.cancel();
    setIsReading(false);
  }, []);

  // Fallback to browser TTS
  const playBrowserTTS = useCallback((text: string) => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.1;

    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);

    setIsReading(true);
    speechSynthesis.speak(utterance);
  }, []);

  // Persist autoReadAloud preference
  const persistAutoReadAloud = useCallback(
    async (enabled: boolean) => {
      if (!firestore || !childId) return;
      try {
        const childRef = doc(firestore, 'children', childId);
        await updateDoc(childRef, { autoReadAloud: enabled });
      } catch (e) {
        console.warn('[KidsStoryRead] Failed to persist autoReadAloud:', e);
      }
    },
    [firestore, childId]
  );

  // Handle read aloud
  const handleReadAloud = useCallback(() => {
    if (isReading) {
      stopPlayback();
      persistAutoReadAloud(false);
      return;
    }

    if (!story) return;

    // Use resolved text from server
    const textToRead = story.storyTextResolved || story.storyText || '';
    if (!textToRead) return;

    persistAutoReadAloud(true);

    // Check if AI audio is available
    if (story.audioUrl && story.audioGeneration?.status === 'ready') {
      const audio = new Audio(story.audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsReading(false);
        audioRef.current = null;
      };

      audio.onerror = () => {
        console.warn('[KidsStoryRead] AI audio failed, using browser TTS');
        audioRef.current = null;
        playBrowserTTS(textToRead);
      };

      setIsReading(true);
      audio.play().catch(() => playBrowserTTS(textToRead));
    } else {
      playBrowserTTS(textToRead);
    }
  }, [isReading, story, stopPlayback, playBrowserTTS, persistAutoReadAloud]);

  // Auto-start reading if preference enabled
  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (
      childProfile?.autoReadAloud &&
      story &&
      (story.storyTextResolved || story.storyText) &&
      !isReading &&
      !loading &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      const timer = setTimeout(() => handleReadAloud(), 500);
      return () => clearTimeout(timer);
    }
  }, [childProfile?.autoReadAloud, story, isReading, loading, handleReadAloud]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      speechSynthesis.cancel();
    };
  }, []);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading state
  if (userLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="text-xl font-semibold text-amber-900 mb-2">Something went wrong</h2>
        <p className="text-amber-700 text-center mb-4">{error}</p>
        <Button asChild className="bg-amber-500 hover:bg-amber-600">
          <Link href="/kids/stories">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Stories
          </Link>
        </Button>
      </div>
    );
  }

  // Story not found or doesn't belong to this child
  if (!story || story.childId !== childId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4">
        <div className="text-5xl mb-4">📖</div>
        <h2 className="text-xl font-semibold text-amber-900 mb-2">Story not found</h2>
        <p className="text-amber-700 text-center mb-4">We couldn't find this story.</p>
        <Button asChild className="bg-amber-500 hover:bg-amber-600">
          <Link href="/kids/stories">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Stories
          </Link>
        </Button>
      </div>
    );
  }

  // Use resolved text from server (already resolved server-side)
  const displayTitle = story.titleResolved || story.metadata?.title || 'Your Story';
  const displayText = story.storyTextResolved || story.storyText || '';
  const actors = story.actors || [];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header */}
      <header className="sticky top-0 z-50 px-4 py-3 flex items-center justify-between bg-white/80 backdrop-blur border-b border-amber-200">
        <Link href="/kids/stories">
          <Button variant="ghost" size="icon" className="text-amber-700">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          {/* Actor avatars from server response */}
          {actors.length > 0 && (
            <div className="flex -space-x-2">
              {actors.slice(0, 3).map((actor) => (
                <Avatar key={actor.id} className="h-8 w-8 border-2 border-white">
                  {actor.avatarUrl ? (
                    <AvatarImage src={actor.avatarUrl} alt={actor.displayName} />
                  ) : null}
                  <AvatarFallback className="bg-amber-200 text-amber-800 text-xs">
                    {actor.displayName?.charAt(0) || '?'}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
          )}
        </div>

        {/* Read aloud button */}
        <Button
          variant={isReading ? 'default' : 'secondary'}
          size="sm"
          onClick={handleReadAloud}
          className={isReading ? 'bg-amber-500 hover:bg-amber-600' : ''}
        >
          {isReading ? (
            <>
              <VolumeX className="mr-1 h-4 w-4" />
              Stop
            </>
          ) : (
            <>
              <Volume2 className="mr-1 h-4 w-4" />
              Read to Me
            </>
          )}
        </Button>
      </header>

      {/* Story content */}
      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        {/* Actor avatar display */}
        {story.actorAvatarUrl && (
          <div className="flex justify-center mb-6">
            <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-amber-200 shadow-lg">
              <img
                src={story.actorAvatarUrl}
                alt="Story characters"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Title */}
        <h1 className="text-2xl font-bold text-amber-900 text-center mb-6">{displayTitle}</h1>

        {/* Story text (already resolved from server) */}
        <div className="space-y-4">
          {displayText.split('\n\n').map((paragraph, index) => (
            <p key={index} className="text-lg text-gray-800 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>

        {/* Storybooks and Actions - matching mobile app layout */}
        <div className="mt-8 pt-6 border-t border-amber-200 space-y-3">
          {/* Existing storybooks with thumbnails */}
          {storybooks.map((sb) => (
            <Link
              key={sb.id}
              href={`/kids/read/${storyId}?storybookId=${sb.id}`}
              className="flex items-center gap-3 p-3 bg-emerald-500 rounded-2xl shadow-md hover:bg-emerald-600 transition-colors"
            >
              {sb.thumbnailUrl ? (
                <img
                  src={sb.thumbnailUrl}
                  alt=""
                  className="w-14 h-14 rounded-lg object-cover bg-white"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-white/30 flex items-center justify-center">
                  <span className="text-2xl">📚</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold truncate">
                  {sb.imageStyleName || 'Picture Book'}
                </div>
                {sb.outputTypeName && (
                  <div className="text-white/80 text-sm truncate">{sb.outputTypeName}</div>
                )}
              </div>
              <ChevronRight className="h-6 w-6 text-white/80 flex-shrink-0" />
            </Link>
          ))}

          {/* Legacy book button (if exists on story itself) */}
          {story.imageGeneration?.status === 'ready' && (
            <Link
              href={`/kids/read/${storyId}`}
              className="flex items-center justify-center gap-2 p-4 bg-emerald-500 rounded-2xl shadow-md hover:bg-emerald-600 transition-colors"
            >
              <span className="text-2xl">📚</span>
              <span className="text-white font-semibold text-lg">Read Picture Book</span>
            </Link>
          )}

          {/* Generating indicator */}
          {(story.pageGeneration?.status === 'running' || story.imageGeneration?.status === 'running') && (
            <div className="flex items-center justify-center gap-3 p-4 bg-amber-200 rounded-2xl">
              <LoaderCircle className="h-5 w-5 animate-spin text-amber-600" />
              <span className="text-amber-800 font-medium">Creating your book...</span>
            </div>
          )}

          {/* Create book button - always show unless currently generating */}
          {story.pageGeneration?.status !== 'running' && story.imageGeneration?.status !== 'running' && (
            <Link
              href={`/kids/create/${storyId}/style`}
              className="flex items-center justify-center gap-2 p-4 bg-white border-2 border-amber-500 rounded-2xl shadow-md hover:bg-amber-50 transition-colors"
            >
              <Sparkles className="h-5 w-5 text-amber-500" />
              <span className="text-amber-600 font-semibold text-lg">
                {storybooks.length > 0 || story.imageGeneration?.status === 'ready'
                  ? 'Create Another Book'
                  : 'Create Picture Book'}
              </span>
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
