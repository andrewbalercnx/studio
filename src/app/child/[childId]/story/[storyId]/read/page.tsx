'use client';

import { use, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { Story } from '@/lib/types';
import { useResolvePlaceholdersMultiple } from '@/hooks/use-resolve-placeholders';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, ArrowLeft, Volume2, VolumeX, Mic, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

export default function StoryReadPage({
  params,
}: {
  params: Promise<{ childId: string; storyId: string }>;
}) {
  const resolvedParams = use(params);
  const { childId: routeChildId, storyId } = resolvedParams;
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const {
    activeChildId,
    setActiveChildId,
    activeChildProfile,
    activeChildProfileLoading,
  } = useAppContext();

  // State for audio playback
  const [isReading, setIsReading] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync route childId with app context
  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  // Wait for authentication before creating Firestore queries
  const isAuthReady = !userLoading && !!user && !!idTokenResult;

  // Load the story document
  const storyRef = useMemo(
    () => (firestore && storyId && isAuthReady ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, isAuthReady]
  );

  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Resolve placeholders in story text and title using the authenticated Firestore hook
  const textsToResolve = useMemo(
    () => [story?.storyText, story?.metadata?.title],
    [story?.storyText, story?.metadata?.title]
  );
  const { resolvedTexts, isResolving: isResolvingText } = useResolvePlaceholdersMultiple(textsToResolve);
  const resolvedStoryText = resolvedTexts[0];
  const resolvedTitle = resolvedTexts[1];

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
    utterance.rate = 0.9; // Slightly slower for children
    utterance.pitch = 1.1; // Slightly higher pitch

    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);

    setIsReading(true);
    speechSynthesis.speak(utterance);
  }, []);

  // Handle read aloud - prefers AI audio, falls back to browser TTS
  const handleReadAloud = useCallback(() => {
    if (isReading) {
      stopPlayback();
      return;
    }

    if (!story || !resolvedStoryText) return;

    // Check if AI audio is available and ready
    if (story.audioUrl && story.audioGeneration?.status === 'ready') {
      const audio = new Audio(story.audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsReading(false);
        audioRef.current = null;
      };

      audio.onerror = () => {
        console.warn('[StoryReadPage] AI audio failed, falling back to browser TTS');
        audioRef.current = null;
        playBrowserTTS(resolvedStoryText);
      };

      setIsReading(true);
      audio.play().catch(() => {
        playBrowserTTS(resolvedStoryText);
      });
    } else {
      playBrowserTTS(resolvedStoryText);
    }
  }, [isReading, story, resolvedStoryText, stopPlayback, playBrowserTTS]);

  // Request AI audio generation
  const handleGenerateAudio = useCallback(
    async (forceRegenerate = false) => {
      if (isGeneratingAudio || !user || !storyId) return;

      setIsGeneratingAudio(true);
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/storyBook/audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ storyId, forceRegenerate }),
        });

        const result = await response.json();
        if (result.ok) {
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
      } catch {
        toast({
          title: 'Audio generation failed',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      } finally {
        setIsGeneratingAudio(false);
      }
    },
    [isGeneratingAudio, user, storyId, toast]
  );

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

  // Audio status helpers
  const audioStatus = story?.audioGeneration?.status;
  const hasAiAudio = audioStatus === 'ready' && story?.audioUrl;
  const audioFailed = audioStatus === 'error';
  const noAudio = !audioStatus || audioStatus === 'idle';
  const audioGenerating = audioStatus === 'generating' || audioStatus === 'pending';

  // Loading states
  if (userLoading || activeChildProfileLoading || storyLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated
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

  // No child profile
  if (!activeChildProfile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-2xl font-semibold">We couldn't find that profile.</h2>
        <p className="text-muted-foreground">
          Ask your grown-up to choose a profile from the parent section.
        </p>
      </div>
    );
  }

  // Story not found or doesn't belong to this child
  if (!story || story.childId !== routeChildId) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-2xl font-semibold">Story not found</h2>
        <p className="text-muted-foreground">
          We couldn't find this story. It may have been deleted.
        </p>
        <Button asChild variant="outline">
          <Link href={`/child/${routeChildId}/stories`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to My Stories
          </Link>
        </Button>
      </div>
    );
  }

  const displayTitle = resolvedTitle || story.metadata?.title || 'Your Story';

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background">
      {/* Top bar */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur border-b">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/child/${routeChildId}/stories`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>
        </Button>

        {/* Audio controls */}
        <div className="flex items-center gap-2">
          {/* Show generating indicator */}
          {(audioGenerating || isGeneratingAudio) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ChildAvatarAnimation
                avatarAnimationUrl={activeChildProfile?.avatarAnimationUrl}
                avatarUrl={activeChildProfile?.avatarUrl}
                size="sm"
              />
              <span className="hidden sm:inline">Creating narration...</span>
            </div>
          )}

          {/* Generate/regenerate audio button */}
          {(noAudio || audioFailed) && !audioGenerating && !isGeneratingAudio && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleGenerateAudio(audioFailed)}
              title={audioFailed ? 'Retry audio generation' : 'Generate AI voice narration'}
            >
              <Mic className="h-4 w-4 mr-2" />
              {audioFailed ? 'Retry' : 'AI Voice'}
            </Button>
          )}

          {hasAiAudio && !audioGenerating && !isGeneratingAudio && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleGenerateAudio(true)}
              title="Regenerate AI voice"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}

          {/* Read aloud button */}
          <Button
            variant={isReading ? 'default' : 'secondary'}
            size="sm"
            onClick={handleReadAloud}
            disabled={audioGenerating || isGeneratingAudio || isResolvingText}
          >
            {isReading ? (
              <>
                <VolumeX className="mr-2 h-4 w-4" />
                Stop
              </>
            ) : (
              <>
                <Volume2 className="mr-2 h-4 w-4" />
                Read to Me
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Story content */}
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Actor avatar if available */}
        {story.actorAvatarUrl && (
          <div className="flex justify-center mb-6">
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary/20 shadow-lg">
              <img
                src={story.actorAvatarUrl}
                alt="Story characters"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        )}

        {/* Title */}
        <h1 className="text-3xl font-headline text-center mb-8">{displayTitle}</h1>

        {/* Story text */}
        {isResolvingText ? (
          <div className="flex items-center justify-center py-8">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="prose prose-lg dark:prose-invert mx-auto">
            {resolvedStoryText?.split('\n\n').map((paragraph, index) => (
              <p key={index} className="text-lg leading-relaxed mb-6">
                {paragraph}
              </p>
            ))}
          </div>
        )}

        {/* Audio indicator at bottom */}
        {hasAiAudio && (
          <div className="mt-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Mic className="h-4 w-4" />
            AI Voice Ready
          </div>
        )}
      </div>
    </div>
  );
}
