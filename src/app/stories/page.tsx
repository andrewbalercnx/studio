
'use client';

import { useMemo, useEffect } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, query, orderBy, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StorySession, Story } from '@/lib/types';
import { LoaderCircle, BookOpen, Copy, Lock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { useAppContext } from '@/hooks/use-app-context';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useRouter } from 'next/navigation';

type FinalizationBadge = { label: string; variant: 'default' | 'secondary' | 'outline' };

function deriveFinalizationBadge(story?: Story | null): FinalizationBadge {
  const status = story?.storybookFinalization?.status;
  if (status === 'ordered') return { label: 'Ordered', variant: 'default' };
  if (status === 'printable_ready') return { label: 'Printable Ready', variant: 'secondary' };
  if (status === 'finalized' || story?.isLocked) return { label: 'Finalized', variant: 'default' };
  if (story?.imageGeneration?.status === 'ready') return { label: 'Ready to Finalize', variant: 'outline' };
  return { label: 'Draft', variant: 'outline' };
}

function StoryCard({ story, storyBook, bookLoading }: { story: StorySession; storyBook?: Story | null; bookLoading: boolean }) {
  const createdAt = story.createdAt?.toDate ? story.createdAt.toDate() : new Date();
  const hasStoryBook = !!storyBook;
  const pageGenerationStatus = storyBook?.pageGeneration?.status;
  const pageCount = storyBook?.pageGeneration?.pagesCount;
  const imageGenerationStatus = storyBook?.imageGeneration?.status;
  const imageReadyCount = storyBook?.imageGeneration?.pagesReady ?? null;
  const imageTotalCount = storyBook?.imageGeneration?.pagesTotal ?? null;
  const canOpenViewer = hasStoryBook && storyBook?.pageGeneration?.status === 'ready';
  const viewerHref = storyBook?.id ? `/storybook/${storyBook.id}` : `/storybook/${story.id}`;
  const finalBadge = deriveFinalizationBadge(storyBook);
  const openStorybookButton = (
    <Button asChild className="w-full" disabled={!canOpenViewer}>
      <Link href={viewerHref}>
        {canOpenViewer ? 'Open Storybook' : bookLoading ? 'Loading storybook…' : 'Open Storybook'}
      </Link>
    </Button>
  );
  const viewStoryTextButton = hasStoryBook ? (
    <Button asChild variant="outline" className="w-full">
      <Link href={`/story/session/${story.id}/compiled`}>
        View Story Text
      </Link>
    </Button>
  ) : (
    <Button variant="outline" className="w-full" disabled title="Story text is only available after compiling.">
      {bookLoading ? 'Checking for book…' : 'View Story Text'}
    </Button>
  );
  const helperMessage = hasStoryBook
    ? null
    : story.status === 'completed'
      ? 'Run the compile step on this session to unlock the finished text.'
      : 'Finish the adventure to compile the story text.';
  
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{story.storyTitle || 'Untitled Story'}</CardTitle>
        <CardDescription>
          Created {formatDistanceToNow(createdAt, { addSuffix: true })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className="flex flex-wrap gap-2">
            {story.storyVibe && <Badge variant="outline">{story.storyVibe}</Badge>}
            <Badge variant="secondary">{story.currentPhase}</Badge>
            <Badge variant={finalBadge.variant}>{finalBadge.label}</Badge>
            {storyBook?.isLocked && (
              <Badge variant="default" className="gap-1">
                <Lock className="h-3 w-3" />
                Locked
              </Badge>
            )}
            {pageGenerationStatus && (
              <Badge variant="outline">Pages: {pageGenerationStatus}</Badge>
            )}
            {imageGenerationStatus && (
              <Badge variant="outline">Art: {imageGenerationStatus}</Badge>
            )}
        </div>
        {pageCount ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Saved pages: {pageCount}
          </p>
        ) : null}
        {imageReadyCount !== null && imageTotalCount !== null && (
          <p className="text-xs text-muted-foreground mt-1">Illustrated pages: {imageReadyCount}/{imageTotalCount}</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href={`/story/session/${story.id}`}>
            {story.status === 'completed' ? 'Open Session' : 'Continue Story'}
          </Link>
        </Button>
        {openStorybookButton}
        {viewStoryTextButton}
        {helperMessage && (
          <p className="text-xs text-muted-foreground text-center w-full">{bookLoading ? 'Looking for the compiled book…' : helperMessage}</p>
        )}
      </CardFooter>
    </Card>
  );
}

export default function MyStoriesPage() {
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { activeChildId, roleMode } = useAppContext();
  const router = useRouter();

  useEffect(() => {
    if (roleMode === 'child' && activeChildId) {
      router.replace(`/child/${activeChildId}`);
    }
  }, [roleMode, activeChildId, router]);

  const storiesQuery = useMemo(() => {
    if (!firestore || !activeChildId) return null;
    return query(
      collection(firestore, 'children', activeChildId, 'sessions'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, activeChildId]);

  const { data: stories, loading: storiesLoading, error: storiesError } = useCollection<StorySession>(storiesQuery);
  const storyBooksQuery = useMemo(() => {
    if (!firestore || !activeChildId) return null;
    return query(
      collection(firestore, 'stories'),
      where('childId', '==', activeChildId)
    );
  }, [firestore, activeChildId]);
  const { data: storyBooks, loading: storyBooksLoading } = useCollection<Story>(storyBooksQuery);
  const storyBooksBySessionId = useMemo(() => {
    const map: Record<string, Story> = {};
    if (storyBooks) {
      for (const book of storyBooks) {
        if (book?.storySessionId) {
          map[book.storySessionId] = book;
        }
      }
    }
    return map;
  }, [storyBooks]);
  const isStoryBookLookupPending = storyBooksLoading && !storyBooks;

  useEffect(() => {
    if (storiesError) {
      const permissionError = new FirestorePermissionError({
        path: `children/${activeChildId}/sessions`,
        operation: 'list',
      });
      errorEmitter.emit('permission-error', permissionError);
    }
  }, [storiesError, activeChildId]);

  const diagnostics = useMemo(() => ({
    page: 'stories',
    activeChildId,
    storyCount: stories?.length ?? 0,
    storyBookCount: storyBooks?.length ?? 0,
    pageGenerationStatuses: storyBooks?.map((book) => {
      const completedAtValue = (book.pageGeneration?.lastCompletedAt as any)?.toDate?.();
      return {
        bookId: book.id ?? book.storySessionId,
        sessionId: book.storySessionId,
        status: book.pageGeneration?.status ?? null,
        pagesCount: book.pageGeneration?.pagesCount ?? null,
        lastCompletedAt: completedAtValue ? completedAtValue.toISOString() : null,
        imageStatus: book.imageGeneration?.status ?? null,
        imageReady: book.imageGeneration?.pagesReady ?? null,
        imageTotal: book.imageGeneration?.pagesTotal ?? null,
      };
    }) ?? [],
  }), [activeChildId, stories, storyBooks]);

  const handleCopyDiagnostics = () => {
    const textToCopy = `Page: stories\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`;
    navigator.clipboard.writeText(textToCopy);
  };

  if (userLoading || (storiesLoading && !stories)) {
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
                <CardTitle>Please Sign In</CardTitle>
                <CardDescription>You need to be signed in to see your stories.</CardDescription>
            </CardHeader>
            <CardContent>
                <Button asChild><Link href="/login">Sign In</Link></Button>
            </CardContent>
        </Card>
      </div>
    );
  }
  
  if (storiesError && !stories) {
      return <div className="text-center p-8 text-destructive">Error loading stories. You may not have permission to view them.</div>
  }
  
  if (roleMode === 'child' && activeChildId) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeChildId) {
    return (
      <div className="text-center py-16 border-2 border-dashed rounded-lg container mx-auto">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium">No child selected!</h3>
        <p className="mt-1 text-sm text-muted-foreground">Please go to the homepage to select a child profile first.</p>
        <div className="mt-6">
            <Button asChild>
                <Link href="/">Select a Child</Link>
            </Button>
        </div>
     </div>
    );
  }

  return (
    <>
    <div className="container mx-auto px-4 py-8 sm:py-12">
        <div className="flex justify-between items-center mb-8">
            <h1 className="text-4xl font-bold font-headline">My Stories</h1>
             <Button asChild>
                <Link href="/story/start">Create New Story</Link>
            </Button>
        </div>

      {stories && stories.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {stories.map(story => (
              <StoryCard
                key={story.id}
                story={story}
                storyBook={storyBooksBySessionId[story.id]}
                bookLoading={isStoryBookLookupPending}
              />
            ))}
        </div>
      ) : (
         <div className="text-center py-16 border-2 border-dashed rounded-lg">
            <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">No stories yet!</h3>
            <p className="mt-1 text-sm text-muted-foreground">Ready to create your first magical adventure?</p>
            <div className="mt-6">
                <Button asChild>
                    <Link href="/story/start">Start a New Story</Link>
                </Button>
            </div>
         </div>
      )}
    </div>
    <Card className="mx-auto mt-10 max-w-4xl">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>Includes storybook page generation status.</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={handleCopyDiagnostics} title="Copy diagnostics">
          <Copy className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-4 text-xs">
          <code>{JSON.stringify(diagnostics, null, 2)}</code>
        </pre>
      </CardContent>
    </Card>
    </>
  );
}
