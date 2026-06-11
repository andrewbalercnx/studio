'use client';

import { use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../../layout';
import { useRequiredApiClient } from '@/contexts/api-client-context';
import type { StoryOutputPage, StoryBookOutput } from '@/lib/types';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ImmersivePlayer } from '@/components/book-reader';

// Extended story type with resolved fields from API
type StoryWithResolved = {
  id: string;
  childId: string;
  metadata?: { title?: string };
  titleResolved?: string;
};

export default function KidsReadBookPage({ params }: { params: Promise<{ bookId: string }> }) {
  const resolvedParams = use(params);
  const storybookId = resolvedParams.bookId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useUser();
  const { childId, isLocked } = useKidsPWA();

  // API client for data fetching
  const apiClient = useRequiredApiClient();

  // storyId is required in query params
  const storyId = searchParams.get('storyId');

  // State
  const [story, setStory] = useState<StoryWithResolved | null>(null);
  const [storybook, setStorybook] = useState<StoryBookOutput | null>(null);
  const [pages, setPages] = useState<StoryOutputPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load data via API
  useEffect(() => {
    if (!apiClient || !storyId || !storybookId) return;

    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        // Load story, pages, and storybook in parallel
        const [storyData, pagesData, storybooks] = await Promise.all([
          apiClient.getStory(storyId),
          apiClient.getStorybookPages(storyId, storybookId),
          apiClient.getMyStorybooks(storyId, true),
        ]);

        setStory(storyData as StoryWithResolved);
        setPages(pagesData);

        // Find the storybook for title override
        const sb = storybooks.find((s) => s.id === storybookId);
        if (sb) setStorybook(sb);
      } catch (err: any) {
        // Kid-safe copy only — raw error stays in the console for diagnostics.
        console.error('[KidsReadBook] Error loading data:', err);
        setError("We couldn't open your book right now.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [apiClient, storyId, storybookId]);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Missing storyId parameter
  if (!storyId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-amber-50 to-orange-50 gap-4">
        <p className="text-amber-800">Missing story information.</p>
        <Button asChild>
          <Link href="/kids/books">Go to My Books</Link>
        </Button>
      </div>
    );
  }

  // Loading state
  if (userLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error state — kid-safe and friendly, never technical
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-amber-50 to-orange-50 gap-4">
        <span className="text-6xl" role="img" aria-label="sleepy book">📖💤</span>
        <h1 className="text-xl font-bold text-amber-900 text-center">This book is being shy!</h1>
        <p className="text-amber-700 text-center max-w-xs">{error} Let&apos;s try again!</p>
        <div className="flex gap-3">
          <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => window.location.reload()}>
            Try Again
          </Button>
          <Button asChild variant="outline">
            <Link href="/kids/books">Go to My Books</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Get title from storybook or story
  const bookTitle = storybook?.title || story?.titleResolved || story?.metadata?.title;

  // No story or pages
  if (!story || pages.length === 0) {
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
