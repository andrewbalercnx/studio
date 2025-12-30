'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../layout';
import type { Story, StoryBookOutput, ImageStyle, StoryOutputType } from '@/lib/types';
import { LoaderCircle, BookOpen, ArrowLeft, Moon, Clock, Play, Sparkles } from 'lucide-react';
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
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
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
  isNewModel: boolean;
};

export default function KidsBooksPage() {
  const router = useRouter();
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked, isLoading: kidsLoading } = useKidsPWA();

  const [completedBooks, setCompletedBooks] = useState<CompletedBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);

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

  // Query stories for this child (only when authenticated and auth token is ready)
  const storiesQuery = useMemo(() => {
    if (!firestore || !childId || !user || userLoading || !idTokenResult) return null;
    return query(
      collection(firestore, 'stories'),
      where('childId', '==', childId)
    );
  }, [firestore, childId, user, userLoading, idTokenResult]);

  const { data: stories, loading: storiesLoading } = useCollection<Story>(storiesQuery);

  // Load output types and image styles for display
  const outputTypesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'storyOutputTypes'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: outputTypes } = useCollection<StoryOutputType>(outputTypesQuery);

  const imageStylesQuery = useMemo(() => {
    if (!firestore || !user || userLoading || !idTokenResult) return null;
    return query(collection(firestore, 'imageStyles'));
  }, [firestore, user, userLoading, idTokenResult]);
  const { data: imageStyles } = useCollection<ImageStyle>(imageStylesQuery);

  // Load completed storybooks from subcollections
  useEffect(() => {
    const loadCompletedBooks = async () => {
      if (!firestore || !stories || storiesLoading) return;

      setBooksLoading(true);
      const books: CompletedBook[] = [];

      // Helper to get cover image from pages collection
      const getCoverImage = async (pagesPath: string): Promise<string | undefined> => {
        try {
          const pagesRef = collection(firestore, pagesPath);
          const pagesQuery = query(pagesRef, where('pageNumber', '==', 0), orderBy('pageNumber', 'asc'));
          const pagesSnap = await getDocs(pagesQuery);
          if (!pagesSnap.empty) {
            const coverPage = pagesSnap.docs[0].data();
            if (coverPage.imageUrl && coverPage.imageStatus === 'ready') {
              return coverPage.imageUrl;
            }
          }
        } catch (err) {
          // Silently fail - cover image is optional
        }
        return undefined;
      };

      // First, check legacy model - show if pages are ready (regardless of image status)
      for (const story of stories) {
        // Skip soft-deleted stories
        if (story.deletedAt) continue;

        if (story.pageGeneration?.status === 'ready' || story.imageGeneration?.status === 'ready') {
          const storyId = story.id || story.storySessionId;
          // Legacy book - load cover from pages (try both paths)
          let thumbnailUrl = await getCoverImage(`stories/${storyId}/outputs/storybook/pages`);
          if (!thumbnailUrl) {
            thumbnailUrl = await getCoverImage(`stories/${storyId}/pages`);
          }

          books.push({
            storybookId: storyId,
            storyId: storyId,
            title: story.metadata?.title,
            thumbnailUrl,
            storyOutputTypeId: (typeof story.metadata?.storyOutputTypeId === 'string' ? story.metadata.storyOutputTypeId : '') || '',
            imageStyleId: story.selectedImageStyleId || '',
            createdAt: story.updatedAt?.toDate?.() || story.createdAt?.toDate?.() || new Date(),
            imageGenerationStatus: story.imageGeneration?.status || 'pending',
            isNewModel: false,
          });
        }

        // Check new model (storybooks subcollection)
        try {
          const storyId = story.id || story.storySessionId;
          const storybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
          const storybooksSnap = await getDocs(storybooksRef);

          for (const sbDoc of storybooksSnap.docs) {
            const sb = sbDoc.data() as StoryBookOutput;
            // Skip soft-deleted storybooks
            if (sb.deletedAt) continue;

            // Show if pages are ready (regardless of image status)
            if (sb.pageGeneration?.status === 'ready' || sb.imageGeneration?.status === 'ready') {
              // Load cover from new model pages path
              const thumbnailUrl = await getCoverImage(`stories/${storyId}/storybooks/${sbDoc.id}/pages`);

              books.push({
                storybookId: sbDoc.id,
                storyId: storyId,
                title: sb.title || story.metadata?.title,
                thumbnailUrl,
                storyOutputTypeId: sb.storyOutputTypeId,
                imageStyleId: sb.imageStyleId,
                createdAt: sb.createdAt?.toDate?.() || new Date(),
                imageGenerationStatus: sb.imageGeneration?.status || 'pending',
                isNewModel: true,
              });
            }
          }
        } catch (err) {
          console.error('Error loading storybooks for story:', story.id, err);
        }
      }

      // Sort by created date, most recent first
      books.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setCompletedBooks(books);
      setBooksLoading(false);
    };

    loadCompletedBooks();
  }, [firestore, stories, storiesLoading]);

  // Helper to get output type label
  const getOutputTypeLabel = (id: string) => {
    return outputTypes?.find((t) => t.id === id)?.childFacingLabel || 'Picture Book';
  };

  // Helper to get image style title
  const getImageStyleTitle = (id: string) => {
    return imageStyles?.find((s) => s.id === id)?.title || 'Custom';
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

  const isLoading = storiesLoading || booksLoading;

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
            {isLoading ? 'Loading...' : `${completedBooks.length} books`}
          </p>
        </div>
      </header>

      {/* Books list */}
      <main className="flex-1 px-4 py-4">
        <div className="max-w-md mx-auto space-y-4">
          {isLoading ? (
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

  // Build the read URL based on model type
  const readUrl = book.isNewModel
    ? `/kids/read/${book.storybookId}?storyId=${book.storyId}`
    : `/kids/read/${book.storybookId}`;

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
