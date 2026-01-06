'use client';

import { use, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../../layout';
import type { Story, StoryOutputPage, StoryBookOutput } from '@/lib/types';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ImmersivePlayer } from '@/components/book-reader';

export default function KidsReadBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const resolvedParams = use(params);
  const bookId = resolvedParams.bookId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, isLocked } = useKidsPWA();

  // Check if this is the new model (storyId in query params)
  const storyIdParam = searchParams.get('storyId');
  const isNewModel = !!storyIdParam;
  const storyId = storyIdParam || bookId; // For new model, storyId is separate; for legacy, bookId IS the storyId

  // Load story
  const storyRef = useMemo(
    () => (firestore ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Load storybook (for new model - to get title override)
  const storybookRef = useMemo(
    () => (firestore && isNewModel ? doc(firestore, 'stories', storyId, 'storybooks', bookId) : null),
    [firestore, isNewModel, storyId, bookId]
  );
  const { data: storybook, loading: storybookLoading } = useDocument<StoryBookOutput>(storybookRef);

  // Load pages - different paths for legacy vs new model
  const pagesQuery = useMemo(() => {
    if (!firestore || !bookId) return null;

    if (isNewModel && storyId) {
      // New model: pages are in stories/{storyId}/storybooks/{storybookId}/pages
      return query(
        collection(firestore, 'stories', storyId, 'storybooks', bookId, 'pages'),
        orderBy('pageNumber', 'asc')
      );
    } else {
      // Legacy model: try stories/{bookId}/pages first (wizard flow)
      return query(
        collection(firestore, 'stories', bookId, 'pages'),
        orderBy('pageNumber', 'asc')
      );
    }
  }, [firestore, isNewModel, storyId, bookId]);
  const { data: pages, loading: pagesLoading } = useCollection<StoryOutputPage>(pagesQuery);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Loading state
  const isLoading = userLoading || storyLoading || pagesLoading || (isNewModel && storybookLoading);
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Get title from storybook (new model) or story (legacy)
  const bookTitle = isNewModel ? (storybook?.title || story?.metadata?.title) : story?.metadata?.title;

  // No story or pages
  if (!story || !pages || pages.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-amber-50 to-orange-50 gap-4">
        <p className="text-amber-800">Book not found or still being created.</p>
        <Button asChild>
          <Link href="/kids/books">Go to My Books</Link>
        </Button>
      </div>
    );
  }

  // Security check: Verify story belongs to the current locked child
  if (story.childId !== childId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-amber-50 to-orange-50 gap-4">
        <p className="text-amber-800">This book belongs to someone else.</p>
        <Button asChild>
          <Link href="/kids/books">Go to My Books</Link>
        </Button>
      </div>
    );
  }

  return (
    <ImmersivePlayer
      pages={pages}
      bookTitle={bookTitle}
      onExit={() => router.push('/kids/books')}
      onPlayAgain={() => {
        // Reset is handled internally by ImmersivePlayer
      }}
    />
  );
}
