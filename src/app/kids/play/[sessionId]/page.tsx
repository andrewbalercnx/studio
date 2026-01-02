'use client';

import { useMemo, useEffect } from 'react';
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
import { useKidsPWA } from '../../layout';

/**
 * Kids PWA Story Play Page
 *
 * This page provides interactive story creation for kids in the PWA.
 * It uses the same StoryBrowser component as the parent-facing flow.
 */
export default function KidsPlayPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile: contextChildProfile, isLocked } = useKidsPWA();

  // Load session to get generator ID
  const sessionRef = useMemo(
    () => (firestore ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Load child profile from session (may differ from context)
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

  // Redirect if not set up (kids PWA requires PIN lock)
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading state
  if (userLoading || sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error state
  if (!user || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <div className="text-center p-8 space-y-4">
          <p className="text-gray-700">Could not load story. Please try again.</p>
          <Button asChild variant="outline">
            <Link href="/kids">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Verify session belongs to the locked child
  if (session.childId !== childId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <div className="text-center p-8 space-y-4">
          <p className="text-gray-700">This story belongs to another child.</p>
          <Button asChild variant="outline">
            <Link href="/kids">Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Determine the generator ID from the session's storyMode
  const generatorId = session.storyMode || 'beat';

  // Navigate to stories page on completion
  const completionRedirectPath = '/kids/stories';

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50">
      <StoryBrowser
        sessionId={sessionId}
        generatorId={generatorId}
        childProfile={childProfile ?? contextChildProfile ?? null}
        storyTypes={storyTypes ?? undefined}
        completionRedirectPath={completionRedirectPath}
        showSettingsLink={false}  // No settings link in kids UI
      />
    </div>
  );
}
