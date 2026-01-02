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
 * Story Wizard page using the unified StoryBrowser component.
 *
 * The wizard asks 4 questions and generates a complete story.
 * After completion, it auto-compiles the story and redirects to the stories list.
 */
export default function StoryWizardPage() {
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
        description: 'Saving your story...',
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
            title: 'Story saved!',
            description: 'Your story is ready to view.',
          });
        }
      } catch (compileError) {
        console.error('[wizard] Compile error:', compileError);
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
      title: 'Wizard Error',
      description: error,
      variant: 'destructive',
    });
  };

  // Loading state
  if (sessionLoading || childLoading || !session) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Loading...</p>
      </div>
    );
  }

  return (
    <StoryBrowser
      sessionId={sessionId}
      generatorId="wizard"
      childProfile={childProfile ?? null}
      onStoryComplete={handleStoryComplete}
      onError={handleError}
      showSettingsLink={true}
    />
  );
}
