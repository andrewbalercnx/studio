'use client';

import { use, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryOutputPage, StoryBookOutput } from '@/lib/types';
import { useUser } from '@/firebase/auth/use-user';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle } from 'lucide-react';
import { ImmersivePlayer } from '@/components/book-reader';

export default function BookPlayPage({
  params,
}: {
  params: Promise<{ childId: string; storybookId: string }>;
}) {
  const resolvedParams = use(params);
  const { childId: routeChildId, storybookId: bookId } = resolvedParams;
  const router = useRouter();
  const searchParams = useSearchParams();
  const firestore = useFirestore();
  const { user, idTokenResult, loading: userLoading } = useUser();
  const { activeChildId, setActiveChildId } = useAppContext();

  // If storyId is provided as query param, this is a new-model storybook (subcollection)
  const storyIdParam = searchParams.get('storyId');
  const isNewModel = !!storyIdParam;
  const storyId = storyIdParam || bookId; // For new model, storyId is separate; for legacy, bookId IS the storyId

  // Sync route childId with app context
  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  // Wait for authentication before creating Firestore queries
  const isAuthReady = !userLoading && !!user && !!idTokenResult;

  // Firestore queries - only create them after auth is ready
  const storyRef = useMemo(
    () => (firestore && storyId && isAuthReady ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, isAuthReady]
  );

  const storybookRef = useMemo(
    () =>
      firestore && isNewModel && storyId && bookId && isAuthReady
        ? doc(firestore, 'stories', storyId, 'storybooks', bookId)
        : null,
    [firestore, isNewModel, storyId, bookId, isAuthReady]
  );

  // Pages query: different paths for legacy vs new model
  const pagesQuery = useMemo(() => {
    if (!firestore || !isAuthReady) return null;
    if (isNewModel && storyId && bookId) {
      // New model: pages are in stories/{storyId}/storybooks/{storybookId}/pages
      return query(
        collection(firestore, 'stories', storyId, 'storybooks', bookId, 'pages'),
        orderBy('pageNumber', 'asc')
      );
    } else if (bookId) {
      // Legacy model: pages are in stories/{bookId}/outputs/storybook/pages
      return query(
        collection(firestore, 'stories', bookId, 'outputs', 'storybook', 'pages'),
        orderBy('pageNumber', 'asc')
      );
    }
    return null;
  }, [firestore, isNewModel, storyId, bookId, isAuthReady]);

  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);
  const { data: storybookOutput, loading: storybookOutputLoading } =
    useDocument<StoryBookOutput>(storybookRef);
  const { data: pages, loading: pagesLoading } = useCollection<StoryOutputPage>(pagesQuery);

  // Unified storyBook object that works for both models
  const storyBook = useMemo(() => {
    if (isNewModel && storybookOutput && story) {
      return {
        ...story,
        metadata: {
          ...story.metadata,
          title: storybookOutput.title || story.metadata?.title,
        },
      } as Story;
    }
    return story;
  }, [isNewModel, story, storybookOutput]);

  const bookLoading = storyLoading || (isNewModel && storybookOutputLoading);

  // Handle navigation back to books list
  const handleExit = () => {
    router.push(`/child/${routeChildId}/books`);
  };

  // Loading state
  if (userLoading || !isAuthReady || bookLoading || pagesLoading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-primary/10 to-background flex items-center justify-center z-50">
        <div className="text-center space-y-4">
          <LoaderCircle className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading your book...</p>
        </div>
      </div>
    );
  }

  // No pages or not ready
  if (!pages || pages.length === 0) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-primary/10 to-background flex items-center justify-center z-50">
        <div className="text-center space-y-4 p-6">
          <h2 className="text-2xl font-bold">Book Not Ready</h2>
          <p className="text-muted-foreground">
            This book isn't ready to play yet.
          </p>
          <button
            onClick={handleExit}
            className="text-primary underline"
          >
            Back to My Books
          </button>
        </div>
      </div>
    );
  }

  // Filter to only readable pages with images ready (skip blank pages for print alignment)
  const readyPages = pages.filter(
    (p) => p.kind !== 'blank' && p.imageStatus === 'ready' && p.imageUrl
  );

  if (readyPages.length === 0) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-primary/10 to-background flex items-center justify-center z-50">
        <div className="text-center space-y-4 p-6">
          <h2 className="text-2xl font-bold">Images Not Ready</h2>
          <p className="text-muted-foreground">
            The pictures for this book are still being created.
          </p>
          <button
            onClick={handleExit}
            className="text-primary underline"
          >
            Back to My Books
          </button>
        </div>
      </div>
    );
  }

  return (
    <ImmersivePlayer
      pages={readyPages}
      bookTitle={storyBook?.metadata?.title}
      onExit={handleExit}
    />
  );
}
