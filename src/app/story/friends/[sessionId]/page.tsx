'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle } from 'lucide-react';

import { StoryBrowser } from '@/components/story/story-browser';
import type { StorySession, ChildProfile, StoryOutputType } from '@/lib/types';

/**
 * "Fun with my friends" Story page using the unified StoryBrowser component.
 *
 * The friends flow has 4 phases:
 * 1. Character selection - AI proposes companions, child confirms/modifies
 * 2. Scenario selection - Choose an adventure type
 * 3. Synopsis selection - Pick from story synopses
 * 4. Story generation - AI writes the full story
 *
 * After completion, it auto-compiles the story and redirects to the stories list.
 */
export default function StoryFriendsPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  // Fetch session
  const sessionRef = useMemo(
    () => (firestore ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Fetch child profile
  const childRef = useMemo(
    () => (session?.childId && firestore ? doc(firestore, 'children', session.childId) : null),
    [firestore, session?.childId]
  );
  const { data: childProfile, loading: childLoading } = useDocument<ChildProfile>(childRef);

  // Fetch story output types for auto-compile
  const storyOutputTypesQuery = useMemo(
    () => (firestore ? query(collection(firestore, 'storyOutputTypes'), where('status', '==', 'live')) : null),
    [firestore]
  );
  const { data: storyOutputTypes } = useCollection<StoryOutputType>(storyOutputTypesQuery);

  // Handle story completion - auto-compile and redirect
  const handleStoryComplete = async (storyId: string) => {
    const storyOutputTypeId = storyOutputTypes?.[0]?.id;

    if (storyOutputTypeId) {
      toast({
        title: 'Story Complete!',
        description: 'Saving your adventure...',
      });

      try {
        const response = await fetch('/api/storyCompile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, storyOutputTypeId }),
        });
        const compileResult = await response.json();

        if (compileResult.ok) {
          toast({
            title: 'Adventure saved!',
            description: 'Your story with friends is ready to view.',
          });
        }
      } catch (compileError) {
        console.error('[friends] Compile error:', compileError);
      }
    }

    // Redirect to child's stories list
    if (session?.childId) {
      router.push(`/child/${session.childId}/stories`);
    }
  };

  // Handle error
  const handleError = (error: string) => {
    toast({
      title: 'Adventure Error',
      description: error,
      variant: 'destructive',
    });
  };

  // Loading state
  if (sessionLoading || childLoading || !session) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Gathering your friends...</p>
      </div>
    );
  }

  return (
    <StoryBrowser
      sessionId={sessionId}
      generatorId="friends"
      childProfile={childProfile ?? null}
      onStoryComplete={handleStoryComplete}
      onError={handleError}
      showSettingsLink={true}
    />
  );
}
