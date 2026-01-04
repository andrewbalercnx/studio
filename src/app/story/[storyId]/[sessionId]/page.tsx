'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useToast } from '@/hooks/use-toast';
import { LoaderCircle } from 'lucide-react';

import { StoryBrowser } from '@/components/story/story-browser';
import type { StorySession, ChildProfile, StoryOutputType, StoryGenerator } from '@/lib/types';

/**
 * Dynamic story page that works with any generator.
 *
 * This unified route replaces the individual /story/wizard/[sessionId],
 * /story/friends/[sessionId], etc. routes. It uses the StoryBrowser component
 * which adapts its behavior based on the generator configuration.
 *
 * Route: /story/[storyId]/[sessionId]
 * Note: The first segment still carries the generator ID for compatibility.
 * Example: /story/wizard/abc123, /story/friends/xyz789
 */
export default function DynamicStoryPage() {
  const params = useParams<{ storyId: string; sessionId: string }>();
  const { storyId, sessionId } = params;
  const generatorId = storyId; // Path segment represents the generator ID
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();

  // Fetch generator configuration
  const generatorRef = useMemo(
    () => (firestore ? doc(firestore, 'storyGenerators', generatorId) : null),
    [firestore, generatorId]
  );
  const { data: generator, loading: generatorLoading } = useDocument<StoryGenerator>(generatorRef);

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
    const generatorName = generator?.name || generatorId;

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
            description: `Your ${generatorName} story is ready to view.`,
          });
        }
      } catch (compileError) {
        console.error(`[${generatorId}] Compile error:`, compileError);
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
      title: 'Story Error',
      description: error,
      variant: 'destructive',
    });
  };

  // Loading state
  if (generatorLoading || sessionLoading || childLoading || !session) {
    const loadingMessage = generator?.styling?.loadingMessage || 'Loading...';
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">{loadingMessage}</p>
      </div>
    );
  }

  // Generator not found
  if (!generator) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive">Generator &quot;{generatorId}&quot; not found.</p>
      </div>
    );
  }

  return (
    <StoryBrowser
      sessionId={sessionId}
      generatorId={generatorId}
      childProfile={childProfile ?? null}
      onStoryComplete={handleStoryComplete}
      onError={handleError}
      showSettingsLink={true}
    />
  );
}
