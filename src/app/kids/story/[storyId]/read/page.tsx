'use client';

import { use, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { useKidsPWA } from '../../../layout';
import { StoryReader } from '@/components/creation';

/** Kids PWA: read a finished story; its Books and "make a book" underneath. */
export default function KidsStoryReadPage({ params }: { params: Promise<{ storyId: string }> }) {
  const { storyId } = use(params);
  const router = useRouter();
  const firestore = useFirestore();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked } = useKidsPWA();

  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // The child's read-aloud preference lives on the child profile (parent-owned document).
  const persistAutoRead = useCallback(
    (enabled: boolean) => {
      if (!firestore || !childId) return;
      updateDoc(doc(firestore, 'children', childId), { autoReadAloud: enabled }).catch((err) =>
        console.warn('[KidsStoryRead] Failed to persist autoReadAloud:', err)
      );
    },
    [firestore, childId]
  );

  if (userLoading || !user || !childId) {
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
      autoReadAloud={childProfile?.autoReadAloud}
      onAutoReadChange={persistAutoRead}
      backHref="/kids/stories"
      bookHref={(bookId) => `/kids/book/${bookId}`}
      createBookHref={`/kids/create/${storyId}/style`}
      playHref={`/kids/create/${storyId}`}
    />
  );
}
