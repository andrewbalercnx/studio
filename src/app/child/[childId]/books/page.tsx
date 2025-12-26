'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, where, orderBy, getDocs, doc } from 'firebase/firestore';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import type { Story, StoryBookOutput, ImageStyle, StoryOutputType } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, BookOpen, ArrowLeft, Eye, Image as ImageIcon, Clock, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import Image from 'next/image';

/**
 * Format a date in a friendly format like "12th December 2025"
 */
function formatFriendlyDate(date: Date): string {
  const day = date.getDate();
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd'
    : 'th';
  return `${day}${suffix} ${format(date, 'MMMM yyyy')}`;
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

export default function MyBooksPage({ params }: { params: Promise<{ childId: string }> }) {
  const resolvedParams = use(params);
  const routeChildId = resolvedParams.childId;
  const { user, idTokenResult, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const {
    activeChildId,
    setActiveChildId,
    activeChildProfile,
    activeChildProfileLoading,
  } = useAppContext();

  const [completedBooks, setCompletedBooks] = useState<CompletedBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);

  // Sync route childId with app context
  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  // Query stories for this child (only when authenticated and auth token is ready)
  // We wait for idTokenResult to ensure Firebase auth is fully synced with Firestore
  const storiesQuery = useMemo(() => {
    if (!firestore || !activeChildId || !user || userLoading || !idTokenResult) return null;
    return query(
      collection(firestore, 'stories'),
      where('childId', '==', activeChildId)
    );
  }, [firestore, activeChildId, user, userLoading, idTokenResult]);

  const { data: stories, loading: storiesLoading } = useCollection<Story>(storiesQuery);

  // Load output types and image styles for display (only when authenticated and auth token is ready)
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
      // This allows users to see storybooks while images are still generating
      for (const story of stories) {
        // Skip soft-deleted stories (defense in depth - rules should block these anyway)
        if (story.deletedAt) continue;

        if (story.pageGeneration?.status === 'ready' || story.imageGeneration?.status === 'ready') {
          const storyId = story.id || story.storySessionId;
          // Legacy book - load cover from pages
          const thumbnailUrl = await getCoverImage(`stories/${storyId}/outputs/storybook/pages`);

          books.push({
            storybookId: storyId,
            storyId: storyId,
            title: story.metadata?.title,
            thumbnailUrl,
            storyOutputTypeId: (typeof story.metadata?.storyOutputTypeId === 'string' ? story.metadata.storyOutputTypeId : '') || '',
            imageStyleId: story.selectedImageStyleId || '',
            createdAt: story.updatedAt?.toDate?.() || story.createdAt?.toDate?.() || new Date(),
            imageGenerationStatus: story.imageGeneration?.status || 'pending',
          });
        }

        // Check new model (storybooks subcollection)
        try {
          const storyId = story.id || story.storySessionId;
          const storybooksRef = collection(firestore, 'stories', storyId, 'storybooks');
          const storybooksSnap = await getDocs(storybooksRef);

          for (const sbDoc of storybooksSnap.docs) {
            const sb = sbDoc.data() as StoryBookOutput;
            // Skip soft-deleted storybooks (defense in depth - rules should block these anyway)
            if (sb.deletedAt) continue;

            // Show if pages are ready (regardless of image status)
            // This allows users to see storybooks while images are still generating
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

  if (userLoading || activeChildProfileLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Let's Sign In</CardTitle>
            <CardDescription>A parent needs to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="text-2xl font-semibold">We couldn't find that child.</h2>
        <p className="text-muted-foreground">
          Ask your grown-up to choose a profile from the parent section.
        </p>
      </div>
    );
  }

  const isLoading = storiesLoading || booksLoading;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-primary/10 to-background">
      <div className="container mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link href={`/child/${activeChildId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-headline">My Books</h1>
            <p className="text-muted-foreground">
              {isLoading ? 'Loading...' : `${completedBooks.length} illustrated books`}
            </p>
          </div>
        </div>

        {/* Books Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : completedBooks.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {completedBooks.map((book) => (
              <Card key={`${book.storyId}-${book.storybookId}`} className="group flex flex-col border-2 border-primary/20 bg-primary/5 overflow-hidden">
                {/* Book Thumbnail */}
                <div className="aspect-square relative bg-gradient-to-br from-primary/20 to-primary/5">
                  {book.thumbnailUrl ? (
                    <Image
                      src={book.thumbnailUrl}
                      alt={book.title || 'Story book'}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BookOpen className="h-16 w-16 text-primary/40" />
                    </div>
                  )}
                </div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg line-clamp-2">
                    {book.title || 'Untitled Book'}
                  </CardTitle>
                  <CardDescription className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {getOutputTypeLabel(book.storyOutputTypeId)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <ImageIcon className="h-3 w-3 mr-1" />
                      {getImageStyleTitle(book.imageStyleId)}
                    </Badge>
                    {book.imageGenerationStatus === 'running' && (
                      <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                        Making Art
                      </Badge>
                    )}
                    {(book.imageGenerationStatus === 'idle' || book.imageGenerationStatus === 'pending') && (
                      <Badge variant="outline" className="flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" />
                        Art Coming
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pb-2 flex-grow">
                  <p className="text-xs text-muted-foreground">
                    Created {formatFriendlyDate(book.createdAt)}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button asChild className="w-full">
                    <Link href={
                      book.storyId === book.storybookId
                        ? `/child/${activeChildId}/book/${book.storybookId}/play`
                        : `/child/${activeChildId}/book/${book.storybookId}/play?storyId=${book.storyId}`
                    }>
                      <Eye className="mr-2 h-4 w-4" />
                      Play Book
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-dashed max-w-md mx-auto">
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <BookOpen className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">No books yet!</p>
                <p className="text-muted-foreground">
                  Create a book from one of your stories to see it here.
                </p>
              </div>
              <Button asChild>
                <Link href={`/child/${activeChildId}/stories`}>Go to My Stories</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
