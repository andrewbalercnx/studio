'use client';

import { use, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { Story } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, BookOpen, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StoryCard } from '@/components/child/story-card';
import { useToast } from '@/hooks/use-toast';

export default function MyStoriesPage({ params }: { params: Promise<{ childId: string }> }) {
  const resolvedParams = use(params);
  const routeChildId = resolvedParams.childId;
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const {
    activeChildId,
    setActiveChildId,
    activeChildProfile,
    activeChildProfileLoading,
  } = useAppContext();

  // Track which story is currently being read
  const [readingStoryId, setReadingStoryId] = useState<string | null>(null);
  // Track which story is having audio generated
  const [generatingAudioForStoryId, setGeneratingAudioForStoryId] = useState<string | null>(null);
  // Track which story is having actor avatar generated
  const [generatingActorAvatarForStoryId, setGeneratingActorAvatarForStoryId] = useState<string | null>(null);
  // Audio element ref for AI-generated audio
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync route childId with app context
  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  // Query stories for this child (only when authenticated and auth token is ready)
  // We wait for idTokenResult to ensure Firebase auth is fully synced with Firestore
  // Note: We don't use orderBy here to avoid requiring a composite index
  // Instead, we sort client-side in the sortedStories memo below
  const storiesQuery = useMemo(() => {
    if (!firestore || !activeChildId || !user || userLoading || !idTokenResult) return null;
    return query(
      collection(firestore, 'stories'),
      where('childId', '==', activeChildId)
    );
  }, [firestore, activeChildId, user, userLoading, idTokenResult]);

  const { data: storiesRaw, loading: storiesLoading } = useCollection<Story>(storiesQuery);

  // Filter and sort stories client-side
  const stories = useMemo(() => {
    if (!storiesRaw) return null;
    // Filter out soft-deleted stories (defense in depth - rules should block these anyway)
    const nonDeleted = storiesRaw.filter((s) => !s.deletedAt);
    // Sort by createdAt descending (most recent first)
    return [...nonDeleted].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [storiesRaw]);

  // Handle title save
  const handleSaveTitle = useCallback(
    async (storyId: string, newTitle: string) => {
      if (!firestore) return;
      const storyRef = doc(firestore, 'stories', storyId);
      await updateDoc(storyRef, {
        'metadata.title': newTitle,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: 'Title updated',
        description: `Your story is now called "${newTitle}"`,
      });
    },
    [firestore, toast]
  );

  // Stop current audio playback (both AI audio and browser TTS)
  const stopPlayback = useCallback(() => {
    // Stop AI audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    // Stop browser TTS
    speechSynthesis.cancel();
    setReadingStoryId(null);
  }, []);

  // Fallback to browser TTS
  const playBrowserTTS = useCallback((story: Story) => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(story.storyText);
    utterance.rate = 0.9; // Slightly slower for children
    utterance.pitch = 1.1; // Slightly higher pitch

    utterance.onend = () => setReadingStoryId(null);
    utterance.onerror = () => setReadingStoryId(null);

    setReadingStoryId(story.id || null);
    speechSynthesis.speak(utterance);
  }, []);

  // Text-to-speech handler - prefers AI audio, falls back to browser TTS
  const handleReadAloud = useCallback((story: Story) => {
    // Stop any current reading
    if (readingStoryId === story.id) {
      stopPlayback();
      return;
    }

    // Stop any existing playback first
    stopPlayback();

    // Check if AI audio is available and ready
    if (story.audioUrl && story.audioGeneration?.status === 'ready') {
      // Use AI-generated audio
      console.log('[stories] Playing AI audio from URL:', story.audioUrl?.substring(0, 100) + '...');

      let audio: HTMLAudioElement;
      try {
        audio = new Audio(story.audioUrl);
      } catch (err) {
        console.error('[stories] Failed to create Audio element with URL:', story.audioUrl?.substring(0, 100), err);
        playBrowserTTS(story);
        return;
      }
      audioRef.current = audio;

      audio.onended = () => {
        setReadingStoryId(null);
        audioRef.current = null;
      };

      audio.onerror = (e) => {
        // Fallback to browser TTS if audio fails to load
        console.warn('[stories] AI audio failed to load, falling back to browser TTS. URL:', story.audioUrl?.substring(0, 100), e);
        audioRef.current = null;
        playBrowserTTS(story);
      };

      setReadingStoryId(story.id || null);
      audio.play().catch((err) => {
        // Fallback to browser TTS if play fails
        console.warn('[stories] AI audio play() failed:', err, 'URL:', story.audioUrl?.substring(0, 100));
        playBrowserTTS(story);
      });
    } else {
      // No AI audio available, use browser TTS
      playBrowserTTS(story);
    }
  }, [readingStoryId, stopPlayback, playBrowserTTS]);

  // Request AI audio generation (runs in background)
  const handleGenerateAudio = useCallback(async (storyId: string, forceRegenerate = false) => {
    if (generatingAudioForStoryId) return; // Already generating
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to generate audio.',
        variant: 'destructive',
      });
      return;
    }

    setGeneratingAudioForStoryId(storyId);
    try {
      // Get fresh ID token for auth
      const idToken = await user.getIdToken();

      const response = await fetch('/api/storyBook/audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ storyId, forceRegenerate }),
      });

      const result = await response.json();
      if (result.ok) {
        // API returns immediately - audio generates in background
        // The story's audioGeneration.status will update via real-time listener
        toast({
          title: 'Generating audio...',
          description: 'This may take a minute. The page will update when ready.',
        });
      } else {
        toast({
          title: 'Audio generation failed',
          description: result.errorMessage || 'Please try again later.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Audio generation failed',
        description: 'Please check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      // Clear local generating state - the real-time listener will
      // pick up story.audioGeneration.status changes
      setGeneratingAudioForStoryId(null);
    }
  }, [generatingAudioForStoryId, toast, user]);

  // Request actor avatar generation (runs in background)
  const handleGenerateActorAvatar = useCallback(async (storyId: string, forceRegenerate = false) => {
    if (generatingActorAvatarForStoryId) return; // Already generating
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to generate the cast picture.',
        variant: 'destructive',
      });
      return;
    }

    setGeneratingActorAvatarForStoryId(storyId);
    try {
      // Get fresh ID token for auth
      const idToken = await user.getIdToken();

      const response = await fetch('/api/storyBook/actorAvatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ storyId, forceRegenerate }),
      });

      const result = await response.json();
      if (result.ok) {
        // API returns immediately - avatar generates in background
        // The story's actorAvatarGeneration.status will update via real-time listener
        toast({
          title: 'Creating cast picture...',
          description: 'This may take a moment. The page will update when ready.',
        });
      } else {
        toast({
          title: 'Cast picture generation failed',
          description: result.errorMessage || 'Please try again later.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Cast picture generation failed',
        description: 'Please check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      // Clear local generating state - the real-time listener will
      // pick up story.actorAvatarGeneration.status changes
      setGeneratingActorAvatarForStoryId(null);
    }
  }, [generatingActorAvatarForStoryId, toast, user]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      speechSynthesis.cancel();
    };
  }, []);

  if (userLoading || activeChildProfileLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Let's Sign In</CardTitle>
            <CardDescription>A parent needs to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="text-2xl font-semibold">We couldn't find that child.</h2>
        <p className="text-muted-foreground">
          Ask your grown-up to choose a profile from the parent section.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-primary/10 to-background">
      <div className="container mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/child/${activeChildId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-headline">My Stories</h1>
            <p className="text-muted-foreground">
              {storiesLoading ? 'Loading...' : `${stories?.length ?? 0} stories`}
            </p>
          </div>
        </div>

        {/* Stories Grid */}
        {storiesLoading && !stories ? (
          <div className="flex items-center justify-center py-16">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : stories && stories.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {stories.map((story) => {
              const audioStatus = story.audioGeneration?.status;
              const isAudioGenerating = audioStatus === 'generating' || audioStatus === 'pending' || generatingAudioForStoryId === story.id;
              const isActorAvatarGeneratingExt = generatingActorAvatarForStoryId === story.id;

              return (
                <StoryCard
                  key={story.id}
                  story={story}
                  childId={activeChildId || ''}
                  isReading={readingStoryId === story.id}
                  isAudioGenerating={isAudioGenerating}
                  isActorAvatarGeneratingExternal={isActorAvatarGeneratingExt}
                  childAvatarAnimationUrl={activeChildProfile?.avatarAnimationUrl}
                  childAvatarUrl={activeChildProfile?.avatarUrl}
                  onReadAloud={handleReadAloud}
                  onGenerateAudio={handleGenerateAudio}
                  onGenerateActorAvatar={handleGenerateActorAvatar}
                  onSaveTitle={handleSaveTitle}
                />
              );
            })}
          </div>
        ) : (
          <Card className="border-dashed max-w-md mx-auto">
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <BookOpen className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">No stories yet!</p>
                <p className="text-muted-foreground">
                  Create your first adventure to see it here.
                </p>
              </div>
              <Button asChild>
                <Link href="/story/start">Start a New Story</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
