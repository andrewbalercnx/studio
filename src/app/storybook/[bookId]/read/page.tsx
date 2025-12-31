'use client';

import { useMemo, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import { useDocument, useCollection } from '@/lib/firestore-hooks';
import type { Story, StoryOutputPage, StoryBookOutput } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle, ArrowLeft, Settings } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { useToast } from '@/hooks/use-toast';
import { BookReader } from '@/components/book-reader';

export default function BookReaderPage() {
  const params = useParams<{ bookId: string }>();
  const searchParams = useSearchParams();
  const bookId = params.bookId;
  // If storyId is provided as query param, this is a new-model storybook (subcollection)
  const storyIdParam = searchParams.get('storyId');
  const isNewModel = !!storyIdParam;
  const storyId = storyIdParam || bookId; // For new model, storyId is separate; for legacy, bookId IS the storyId

  const firestore = useFirestore();
  const { user, idTokenResult, loading: userLoading } = useUser();
  const { toast } = useToast();

  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  // Wait for authentication before creating Firestore queries
  // This prevents permission errors from queries running before auth is ready
  const isAuthReady = !userLoading && !!user && !!idTokenResult;

  // Firestore queries - only create them after auth is ready
  // For legacy model: load Story document directly
  // For new model: load Story for metadata and StoryBookOutput for status
  const storyRef = useMemo(
    () => (firestore && storyId && isAuthReady ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, isAuthReady]
  );

  const storybookRef = useMemo(
    () => (firestore && isNewModel && storyId && bookId && isAuthReady
      ? doc(firestore, 'stories', storyId, 'storybooks', bookId)
      : null),
    [firestore, isNewModel, storyId, bookId, isAuthReady]
  );

  // Pages query: different paths for legacy vs new model
  const pagesQuery = useMemo(
    () => {
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
    },
    [firestore, isNewModel, storyId, bookId, isAuthReady]
  );

  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);
  const { data: storybookOutput, loading: storybookOutputLoading } = useDocument<StoryBookOutput>(storybookRef);
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

  // Build the base URL for links back to the viewer/editor
  const viewerUrl = isNewModel
    ? `/storybook/${bookId}?storyId=${storyId}`
    : `/storybook/${bookId}`;

  // Generate audio for a single page
  const handleGeneratePageAudio = useCallback(
    async (pageId: string) => {
      if (!user || !storyId) return;

      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/storyBook/pageAudio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            storyId,
            ...(isNewModel && { storybookId: bookId }),
            pageId,
          }),
        });

        const result = await response.json();
        if (!result.ok) {
          toast({
            title: 'Audio generation failed',
            description: result.errorMessage || 'Please try again.',
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Generating audio...',
            description: 'The page will update when ready.',
          });
        }
      } catch (error) {
        toast({
          title: 'Audio generation failed',
          description: 'Please check your connection and try again.',
          variant: 'destructive',
        });
      }
    },
    [user, storyId, isNewModel, bookId, toast]
  );

  // Generate audio for all pages
  const handleGenerateAllAudio = useCallback(async () => {
    if (!user || !storyId) return;

    setIsGeneratingAudio(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/storyBook/pageAudio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          storyId,
          ...(isNewModel && { storybookId: bookId }),
        }),
      });

      const result = await response.json();
      if (!result.ok) {
        toast({
          title: 'Audio generation failed',
          description: result.errorMessage || 'Please try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Generating audio for all pages...',
          description: 'This may take a few minutes. Pages will update as they complete.',
        });
      }
    } catch (error) {
      toast({
        title: 'Audio generation failed',
        description: 'Please check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingAudio(false);
    }
  }, [user, storyId, isNewModel, bookId, toast]);

  // Loading state - wait for auth and data
  if (userLoading || !isAuthReady || bookLoading || pagesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-primary/5 to-background">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-primary/5 to-background p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Sign In Required</CardTitle>
            <CardDescription>Please sign in to view this storybook.</CardDescription>
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

  // No pages available
  if (!pages || pages.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-primary/5 to-background p-4">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">No Pages Yet</h1>
          <p className="text-muted-foreground">
            This storybook doesn't have any pages yet. Generate pages first.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href={viewerUrl}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Editor
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Filter out blank pages (they're for print alignment only, not reading)
  const readablePages = pages.filter((p) => p.kind !== 'blank');

  // Pages that require images (exclude title_page and blank pages without imagePrompt)
  // This matches the logic in the storybook viewer page
  const pagesRequiringImages = pages.filter(
    (p) => p.kind !== 'title_page' && p.kind !== 'blank' && p.imagePrompt
  );

  // Check if all pages that need images have them ready
  const allImagesReady = pagesRequiringImages.every(
    (p) => p.imageStatus === 'ready' && p.imageUrl
  );

  if (!allImagesReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-primary/5 to-background p-4">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Images Still Generating</h1>
          <p className="text-muted-foreground">
            Some pages are still generating images. Please wait for all images to complete.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href={viewerUrl}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Editor
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      {/* Top bar */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-2 bg-background/80 backdrop-blur border-b">
        <Button asChild variant="ghost" size="sm">
          <Link href={viewerUrl}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit Reader
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={viewerUrl}>
            <Settings className="mr-2 h-4 w-4" />
            Edit Book
          </Link>
        </Button>
      </div>

      {/* Book Reader */}
      <div className="h-[calc(100vh-49px)]">
        <BookReader
          pages={readablePages}
          bookTitle={storyBook?.metadata?.title}
          onGeneratePageAudio={handleGeneratePageAudio}
          onGenerateAllAudio={handleGenerateAllAudio}
          isGeneratingAudio={isGeneratingAudio}
        />
      </div>
    </div>
  );
}
