'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import type { StorySession, StoryType, ChildProfile } from '@/lib/types';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { StoryBrowser } from '@/components/story';

/**
 * Story Play Page
 *
 * This page wraps the StoryBrowser component and provides the session context.
 * The StoryBrowser handles all the story interaction logic including:
 * - Story type selection
 * - Question/option display
 * - TTS and background music
 * - Character introduction
 * - Story completion and auto-compile
 */
export default function StoryPlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();

  // Load session to get generator ID and child ID
  const sessionRef = useMemo(
    () => (firestore ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Load child profile
  const childRef = useMemo(
    () => (session?.childId && firestore ? doc(firestore, 'children', session.childId) : null),
    [firestore, session?.childId]
  );
  const { data: childProfile } = useDocument<ChildProfile>(childRef);

  // Load story types
  const storyTypesQuery = useMemo(
    () => (firestore ? query(collection(firestore, 'storyTypes'), where('status', '==', 'live')) : null),
    [firestore]
  );
  const { data: storyTypes } = useCollection<StoryType>(storyTypesQuery);

  // Loading state
  if (userLoading || sessionLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (!user || !session) {
    return (
      <div className="p-8 text-center">
        <p>Could not load story. Please try again.</p>
        <Button asChild variant="link">
          <Link href="/stories">Back to stories</Link>
        </Button>
      </div>
    );
  }

  // Determine the generator ID from the session's storyMode
  // Default to 'beat' for backward compatibility
  const generatorId = session.storyMode || 'beat';

  // Determine the completion redirect path
  const completionRedirectPath = session.childId
    ? `/child/${session.childId}/stories`
    : '/stories';

  return (
    <StoryBrowser
      sessionId={sessionId}
      generatorId={generatorId}
      childProfile={childProfile ?? null}
      storyTypes={storyTypes ?? undefined}
      completionRedirectPath={completionRedirectPath}
      showSettingsLink={true}
    />
  );
}
