'use client';

import { use, useCallback, useEffect } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { StoryReader } from '@/components/creation';
import { peopleApi } from '@/lib/people/api';

/** Web child shell: read a finished story; its Books and "make a book" underneath. */
export default function StoryReadPage({ params }: { params: Promise<{ childId: string; storyId: string }> }) {
  const { childId, storyId } = use(params);
  const { user, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId, activeChildProfile } = useAppContext();

  useEffect(() => {
    if (childId && childId !== activeChildId) setActiveChildId(childId);
  }, [childId, activeChildId, setActiveChildId]);

  // The child's read-aloud preference lives on the child profile, changed through the route.
  const persistAutoRead = useCallback(
    (enabled: boolean) => {
      peopleApi.update('child', childId, { autoReadAloud: enabled }).catch((err) =>
        console.warn('[StoryRead] Failed to persist autoReadAloud:', err)
      );
    },
    [childId]
  );

  if (userLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <StoryReader
      storyId={storyId}
      childId={childId}
      autoReadAloud={activeChildProfile?.autoReadAloud}
      onAutoReadChange={persistAutoRead}
      backHref={`/child/${childId}/stories`}
      bookHref={(bookId) => `/books/${bookId}`}
      createBookHref={`/child/${childId}/create-book/${storyId}`}
      playHref={`/child/${childId}/create/${storyId}`}
    />
  );
}
