'use client';

import { use, useCallback, useEffect } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { LoaderCircle } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { StoryReader } from '@/components/creation';

/** Web child shell: read a finished story; its Books and "make a book" underneath. */
export default function StoryReadPage({ params }: { params: Promise<{ childId: string; storyId: string }> }) {
  const { childId, storyId } = use(params);
  const firestore = useFirestore();
  const { user, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId, activeChildProfile } = useAppContext();

  useEffect(() => {
    if (childId && childId !== activeChildId) setActiveChildId(childId);
  }, [childId, activeChildId, setActiveChildId]);

  // The child's read-aloud preference lives on the child profile (parent-owned document).
  const persistAutoRead = useCallback(
    (enabled: boolean) => {
      if (!firestore) return;
      updateDoc(doc(firestore, 'children', childId), { autoReadAloud: enabled }).catch((err) =>
        console.warn('[StoryRead] Failed to persist autoReadAloud:', err)
      );
    },
    [firestore, childId]
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
