'use client';

import { use, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../../../layout';
import type { Story, ChildProfile, Character } from '@/lib/types';
import { useResolvePlaceholdersMultiple } from '@/hooks/use-resolve-placeholders';
import { LoaderCircle, ArrowLeft, Volume2, VolumeX, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

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

  // State for audio playback
  const [isReading, setIsReading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load the story document
  const storyRef = useMemo(
    () => (firestore && storyId && user ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, user]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Load actor profiles for avatars
  const [actorProfiles, setActorProfiles] = useState<Map<string, { displayName: string; avatarUrl?: string }>>(new Map());

  useEffect(() => {
    if (!firestore || !story?.actors || story.actors.length === 0) return;

    const loadActors = async () => {
      const profiles = new Map<string, { displayName: string; avatarUrl?: string }>();

      for (const actorId of story.actors || []) {
        if (!actorId) continue;
        try {
          // Try children collection first
          const childDocRef = doc(firestore, 'children', actorId);
          const childDocSnap = await getDoc(childDocRef);
          if (childDocSnap.exists()) {
            const data = childDocSnap.data() as ChildProfile;
            profiles.set(actorId, { displayName: data.displayName, avatarUrl: data.avatarUrl });
            continue;
          }
          // Try characters collection
          const charDocRef = doc(firestore, 'characters', actorId);
          const charDocSnap = await getDoc(charDocRef);
          if (charDocSnap.exists()) {
            const data = charDocSnap.data() as Character;
            profiles.set(actorId, { displayName: data.displayName, avatarUrl: data.avatarUrl });
          }
        } catch (e) {
          console.warn('[KidsStoryRead] Error loading actor:', actorId, e);
        }
      }

      setActorProfiles(profiles);
    };

    loadActors();
  }, [firestore, story?.actors]);

  // Resolve placeholders in story text and title
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

    if (!story || !resolvedStoryText) return;

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
        playBrowserTTS(resolvedStoryText);
      };

      setIsReading(true);
      audio.play().catch(() => playBrowserTTS(resolvedStoryText));
    } else {
      playBrowserTTS(resolvedStoryText);
    }
  }, [isReading, story, resolvedStoryText, stopPlayback, playBrowserTTS, persistAutoReadAloud]);

  // Auto-start reading if preference enabled
  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (
      childProfile?.autoReadAloud &&
      resolvedStoryText &&
      story &&
      !isReading &&
      !isResolvingText &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      const timer = setTimeout(() => handleReadAloud(), 500);
      return () => clearTimeout(timer);
    }
  }, [childProfile?.autoReadAloud, resolvedStoryText, story, isReading, isResolvingText, handleReadAloud]);

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
  if (userLoading || storyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
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

  const displayTitle = resolvedTitle || story.metadata?.title || 'Your Story';
  const actorIds = story.actors || [];

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
          {/* Actor avatars */}
          {actorIds.length > 0 && (
            <div className="flex -space-x-2">
              {actorIds.slice(0, 3).map((actorId) => {
                const profile = actorProfiles.get(actorId);
                return (
                  <Avatar key={actorId} className="h-8 w-8 border-2 border-white">
                    {profile?.avatarUrl ? (
                      <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />
                    ) : null}
                    <AvatarFallback className="bg-amber-200 text-amber-800 text-xs">
                      {profile?.displayName?.charAt(0) || '?'}
                    </AvatarFallback>
                  </Avatar>
                );
              })}
            </div>
          )}
        </div>

        {/* Read aloud button */}
        <Button
          variant={isReading ? 'default' : 'secondary'}
          size="sm"
          onClick={handleReadAloud}
          disabled={isResolvingText}
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

        {/* Story text */}
        {isResolvingText ? (
          <div className="flex items-center justify-center py-8">
            <LoaderCircle className="h-6 w-6 animate-spin text-amber-500" />
          </div>
        ) : (
          <div className="space-y-4">
            {resolvedStoryText?.split('\n\n').map((paragraph, index) => (
              <p key={index} className="text-lg text-gray-800 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>
        )}

        {/* Create book CTA */}
        {story.storyText && !story.imageGeneration?.status && (
          <div className="mt-8 pt-6 border-t border-amber-200 text-center">
            <p className="text-amber-700 mb-3">Want to turn this into a picture book?</p>
            <Button asChild className="bg-amber-500 hover:bg-amber-600">
              <Link href={`/kids/create/${storyId}/style`}>
                <BookOpen className="mr-2 h-4 w-4" />
                Create a Book
              </Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
