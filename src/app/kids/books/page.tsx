'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useKidsPWA } from '../layout';
import { useRequiredApiClient } from '@/contexts/api-client-context';
import { LoaderCircle, BookOpen, ArrowLeft, Moon, Clock, Play, Sparkles } from 'lucide-react';

// Use inline types to avoid conflicts between local types and shared-types package
type StoryOutputType = { id: string; childFacingLabel?: string; [key: string]: any };
type ImageStyle = { id: string; title?: string; [key: string]: any };
type Story = { id?: string; storySessionId?: string; metadata?: { title?: string }; [key: string]: any };
type StoryBookOutput = {
  id?: string;
  title?: string;
  storyOutputTypeId: string;
  imageStyleId: string;
  pageGeneration?: { status?: string };
  imageGeneration?: { status?: string };
  createdAt?: any;
  thumbnailUrl?: string;
  [key: string]: any;
};
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import Image from 'next/image';

// Format date in a kid-friendly way
function formatDate(timestamp: any): string {
  if (!timestamp) return '';
  // Handle Firestore timestamp format from API (seconds)
  if (timestamp.seconds || timestamp._seconds) {
    const seconds = timestamp.seconds || timestamp._seconds;
    const date = new Date(seconds * 1000);
    return formatDateRelative(date);
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return formatDateRelative(date);
}

function formatDateRelative(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

type CompletedBook = {
  storybookId: string;
  storyId: string;
  title?: string;
  thumbnailUrl?: string;
  storyOutputTypeId: string;
  imageStyleId: string;
  createdAt: Date;
  imageGenerationStatus?: string;
};

export default function KidsBooksPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { childId, childProfile, isLocked, isLoading: kidsLoading } = useKidsPWA();

  // API client for data fetching
  const apiClient = useRequiredApiClient();

  // State
  const [completedBooks, setCompletedBooks] = useState<CompletedBook[]>([]);
  const [outputTypes, setOutputTypes] = useState<StoryOutputType[]>([]);
  const [imageStyles, setImageStyles] = useState<ImageStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not set up
  useEffect(() => {
    if (!kidsLoading && !userLoading) {
      if (!user) {
        router.replace('/kids');
        return;
      }
      if (!isLocked || !childId) {
        router.replace('/kids/setup');
      }
    }
  }, [kidsLoading, userLoading, user, isLocked, childId, router]);

  // Load data via API
  useEffect(() => {
    if (!apiClient || !childId) return;

    setLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        // Fetch output types, image styles, and stories in parallel
        const [outputTypesData, imageStylesData, stories] = await Promise.all([
          apiClient.getOutputTypes(),
          apiClient.getImageStyles(),
          apiClient.getMyStories(childId),
        ]);

        setOutputTypes(outputTypesData);
        setImageStyles(imageStylesData);

        // For each story, fetch storybooks
        const books: CompletedBook[] = [];

        await Promise.all(
          stories.map(async (story: Story) => {
            const storyId = story.id || (story as any).storySessionId;
            if (!storyId) return;

            try {
              // includeAll=true to get storybooks in any status (for showing progress)
              const storybooks = await apiClient.getMyStorybooks(storyId, true);

              for (const sb of storybooks as StoryBookOutput[]) {
                // Show if pages are ready (regardless of image status)
                const pageStatus = sb.pageGeneration?.status;
                const imageStatus = sb.imageGeneration?.status;

                if (pageStatus === 'ready' || imageStatus === 'ready') {
                  books.push({
                    storybookId: sb.id!,
                    storyId: storyId,
                    title: sb.title || story.metadata?.title,
                    thumbnailUrl: (sb as any).thumbnailUrl,
                    storyOutputTypeId: sb.storyOutputTypeId,
                    imageStyleId: sb.imageStyleId,
                    createdAt: sb.createdAt
                      ? new Date(((sb.createdAt as any).seconds || (sb.createdAt as any)._seconds || 0) * 1000)
                      : new Date(),
                    imageGenerationStatus: imageStatus || 'pending',
                  });
                }
              }
            } catch (err) {
              console.error('[KidsBooks] Error loading storybooks for story:', storyId, err);
            }
          })
        );

        // Sort by created date, most recent first
        books.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setCompletedBooks(books);
      } catch (err: any) {
        console.error('[KidsBooks] Error loading data:', err);
        setError(err.message || 'Failed to load books');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [apiClient, childId]);

  // Helper to get output type label
  const getOutputTypeLabel = (id: string) => {
    return outputTypes.find((t) => t.id === id)?.childFacingLabel || 'Picture Book';
  };

  // Helper to get image style title
  const getImageStyleTitle = (id: string) => {
    return imageStyles.find((s) => s.id === id)?.title || 'Custom';
  };

  // Loading state
  if (userLoading || kidsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Not locked to a child
  if (!isLocked || !childProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50 p-4">
        <p className="text-amber-800 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>Try Again</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header with child avatar */}
      <header className="px-4 py-4 flex items-center gap-3 border-b border-amber-200 bg-white/50">
        <Link href="/kids">
          <Button variant="ghost" size="icon" className="text-amber-700">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <Avatar className="h-10 w-10 border-2 border-amber-300">
          {childProfile?.avatarUrl ? (
            <AvatarImage src={childProfile.avatarUrl} alt={childProfile.displayName} />
          ) : null}
          <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
            {childProfile?.displayName?.charAt(0).toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-amber-900">My Books</h1>
          <p className="text-sm text-amber-700">
            {loading ? 'Loading...' : `${completedBooks.length} books`}
          </p>
        </div>
      </header>

      {/* Books list */}
      <main className="flex-1 px-4 py-4">
        <div className="max-w-md mx-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <LoaderCircle className="h-8 w-8 animate-spin text-amber-500" />
            </div>
          ) : completedBooks.length > 0 ? (
            completedBooks.map((book) => (
              <BookCard
                key={`${book.storyId}-${book.storybookId}`}
                book={book}
                outputTypeLabel={getOutputTypeLabel(book.storyOutputTypeId)}
                imageStyleTitle={getImageStyleTitle(book.imageStyleId)}
              />
            ))
          ) : (
            <div className="text-center py-12 space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                <BookOpen className="h-10 w-10 text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700">
                No books yet
              </h3>
              <p className="text-gray-500">
                Create a story and turn it into a beautiful book!
              </p>
              <Link href="/kids/create">
                <Button className="bg-amber-500 hover:bg-amber-600">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create a Story
                </Button>
              </Link>
            </div>
          )}
        </div>
      </main>

      {/* Floating create button */}
      {completedBooks.length > 0 && (
        <div className="fixed bottom-6 right-6">
          <Link href="/kids/create">
            <Button
              size="lg"
              className="rounded-full w-14 h-14 bg-amber-500 hover:bg-amber-600 shadow-lg"
            >
              <Sparkles className="h-6 w-6" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// Book card component
function BookCard({
  book,
  outputTypeLabel,
  imageStyleTitle,
}: {
  book: CompletedBook;
  outputTypeLabel: string;
  imageStyleTitle: string;
}) {
  const isReady = book.imageGenerationStatus === 'ready';
  const isGenerating = book.imageGenerationStatus === 'running';
  const isRateLimited = book.imageGenerationStatus === 'rate_limited';
  const isPending = book.imageGenerationStatus === 'idle' || book.imageGenerationStatus === 'pending';

  // Build the read URL (new model: storyId in query params)
  const readUrl = `/kids/read/${book.storybookId}?storyId=${book.storyId}`;

  return (
    <Link href={readUrl} className="block">
      <Card
        className={cn(
          'border-2 transition-all hover:shadow-lg active:scale-98 overflow-hidden',
          isReady && 'border-green-200 hover:border-green-400',
          isGenerating && 'border-amber-200 hover:border-amber-400',
          isRateLimited && 'border-amber-300',
          isPending && 'border-gray-200 hover:border-gray-400'
        )}
      >
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="w-28 h-28 flex-shrink-0 relative bg-gradient-to-br from-amber-100 to-orange-100">
            {book.thumbnailUrl ? (
              <Image
                src={book.thumbnailUrl}
                alt={book.title || 'Story book'}
                fill
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <BookOpen className="h-10 w-10 text-amber-300" />
              </div>
            )}
          </div>

          {/* Content */}
          <CardContent className="flex-1 p-4 pr-4 flex flex-col justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 line-clamp-1">
                {book.title || 'Untitled Book'}
              </h3>
              <div className="flex flex-wrap gap-1 mt-1">
                <Badge variant="secondary" className="text-xs px-2 py-0">
                  {outputTypeLabel}
                </Badge>
                <Badge variant="outline" className="text-xs px-2 py-0">
                  {imageStyleTitle}
                </Badge>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {formatDate(book.createdAt)}
              </span>

              {/* Status indicator */}
              {isReady && (
                <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                  <Play className="h-3 w-3" />
                  Ready!
                </span>
              )}
              {isGenerating && (
                <span className="flex items-center gap-1 text-amber-600 text-xs">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  Making Art
                </span>
              )}
              {isRateLimited && (
                <span className="flex items-center gap-1 text-amber-700 text-xs">
                  <Moon className="h-3 w-3" />
                  Wizard Napping
                </span>
              )}
              {isPending && (
                <span className="flex items-center gap-1 text-gray-500 text-xs">
                  <Clock className="h-3 w-3" />
                  Art Coming
                </span>
              )}
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}
