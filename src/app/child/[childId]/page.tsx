
'use client';

import { use, useEffect, useMemo } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { useCollection } from '@/lib/firestore-hooks';
import type { StorySession, StoryBook } from '@/lib/types';
import { useAppContext } from '@/hooks/use-app-context';
import { LoaderCircle, BookOpen, Sparkles, Copy } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useParentGuard } from '@/hooks/use-parent-guard';
import { formatDistanceToNow } from 'date-fns';

function ChildStoryCard({ story, storyBook, bookLoading }: { story: StorySession; storyBook?: StoryBook | null; bookLoading: boolean }) {
  const createdAt = story.createdAt?.toDate ? story.createdAt.toDate() : new Date();
  const hasStoryBook = !!storyBook;
  const pageGenerationStatus = storyBook?.pageGeneration?.status;
  const pageCount = storyBook?.pageGeneration?.pagesCount;
  const imageGenerationStatus = storyBook?.imageGeneration?.status;
  const imageReadyCount = storyBook?.imageGeneration?.pagesReady ?? null;
  const imageTotalCount = storyBook?.imageGeneration?.pagesTotal ?? null;
  const canOpenViewer = hasStoryBook && storyBook?.pageGeneration?.status === 'ready';
  const viewerHref = storyBook?.id ? `/storybook/${storyBook.id}` : `/storybook/${story.id}`;
  const stage = deriveStoryStage(story, storyBook);
  const isLocked = storyBook?.isLocked ?? false;
  const finalStatus = storyBook?.storybookFinalization?.status;
  const isCelebratory = isLocked || finalStatus === 'finalized' || finalStatus === 'printable_ready' || finalStatus === 'ordered';
  const cardTitle = storyBook?.metadata?.title || story.storyTitle || 'Your Adventure';

  return (
    <Card className="flex flex-col border-2 border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">{cardTitle}</CardTitle>
        <CardDescription>Created {formatDistanceToNow(createdAt, { addSuffix: true })}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        {isCelebratory && (
          <div className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            🎉 Book ready for printing! Ask your grown-up to show the finished pages.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{stage}</Badge>
          {story.storyVibe && <Badge variant="outline">{story.storyVibe}</Badge>}
          <Badge variant="secondary">{story.currentPhase}</Badge>
          {pageGenerationStatus && (
            <Badge variant="outline">Pages: {pageGenerationStatus}</Badge>
          )}
          {imageGenerationStatus && (
            <Badge variant="outline">Art: {imageGenerationStatus}</Badge>
          )}
        </div>
        {pageCount ? (
          <p className="mt-2 text-xs text-muted-foreground">Saved pages: {pageCount}</p>
        ) : null}
        {imageReadyCount !== null && imageTotalCount !== null && (
          <p className="text-xs text-muted-foreground mt-1">Illustrated pages: {imageReadyCount}/{imageTotalCount}</p>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button asChild className="w-full" disabled={!canOpenViewer}>
          <Link href={viewerHref}>
            {canOpenViewer ? 'Open Storybook' : bookLoading ? 'Loading storybook…' : 'Open Storybook'}
          </Link>
        </Button>
        <Button asChild className="w-full" disabled={isLocked}>
          <Link href={`/story/session/${story.id}`}>
            {isLocked ? 'Locked for Printing' : story.status === 'completed' ? 'Open Session' : 'Continue Story'}
          </Link>
        </Button>
        {hasStoryBook ? (
          <Button asChild variant="secondary" className="w-full">
            <Link href={`/story/session/${story.id}/compiled`}>View Story Text</Link>
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" disabled title="The finished story unlocks after it is compiled.">
            {bookLoading ? 'Checking…' : 'View Story Text'}
          </Button>
        )}
        {isLocked && (
          <p className="text-xs text-muted-foreground text-center w-full">
            Your grown-up locked this adventure while it heads to the printer.
          </p>
        )}
        {!hasStoryBook && (
          <p className="text-xs text-muted-foreground text-center w-full">
            {bookLoading
              ? 'Looking for your storybook…'
              : story.status === 'completed'
                ? 'Your grown-up is compiling the story. Peek again soon!'
                : 'Keep playing to finish this story first.'}
          </p>
        )}
      </CardFooter>
    </Card>
  );
}

function deriveStoryStage(story: StorySession, storyBook?: StoryBook | null): string {
  if (storyBook?.imageGeneration?.status === 'ready') {
    return 'Book complete';
  }
  if (storyBook?.imageGeneration?.status === 'running') {
    return 'Art generating';
  }
  if (storyBook?.pageGeneration?.status === 'ready') {
    return 'Pages ready';
  }
  if (storyBook?.pageGeneration?.status === 'running') {
    return 'Building pages';
  }
  if (story.status === 'completed' || storyBook) {
    return 'Story ready';
  }
  if (story.currentPhase === 'ending') {
    return 'Choosing ending';
  }
  if (story.currentPhase === 'story') {
    return 'In progress';
  }
  return 'Warmup';
}

export default function ChildExperiencePage({ params }: { params: Promise<{ childId: string }> }) {
  const resolvedParams = use(params);
  const routeChildId = resolvedParams.childId;
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const {
    activeChildId,
    setActiveChildId,
    activeChildProfile,
    activeChildProfileLoading,
    switchToParentMode,
  } = useAppContext();
  const { showPinModal } = useParentGuard();
  const router = useRouter();

  useEffect(() => {
    console.debug('[ChildPage] route/ctx state', {
      routeChildId,
      activeChildId,
      profileLoading: activeChildProfileLoading,
      hasProfile: !!activeChildProfile,
    });
  }, [routeChildId, activeChildId, activeChildProfileLoading, activeChildProfile]);

  useEffect(() => {
    if (routeChildId && routeChildId !== activeChildId) {
      console.debug('[ChildPage] syncing activeChildId to route', routeChildId);
      setActiveChildId(routeChildId);
    }
  }, [routeChildId, activeChildId, setActiveChildId]);

  const storiesQuery = useMemo(() => {
    if (!firestore || !activeChildId) return null;
    console.debug('[ChildPage] building storiesQuery', {
      activeChildId,
    });
    return query(
      collection(firestore, 'children', activeChildId, 'sessions'),
      orderBy('createdAt', 'desc')
    );
  }, [firestore, activeChildId]);

  const { data: stories, loading: storiesLoading } = useCollection<StorySession>(storiesQuery);
  const storyBooksQuery = useMemo(() => {
    if (!firestore || !activeChildId) return null;
    return query(
      collection(firestore, 'storyBooks'),
      where('childId', '==', activeChildId)
    );
  }, [firestore, activeChildId]);
  const { data: storyBooks, loading: storyBooksLoading } = useCollection<StoryBook>(storyBooksQuery);
  const hasCelebration = useMemo(
    () =>
      (storyBooks ?? []).some(
        (book) =>
          book?.isLocked ||
          (book?.storybookFinalization?.status &&
            ['finalized', 'printable_ready', 'ordered'].includes(book.storybookFinalization.status))
      ),
    [storyBooks]
  );
  const storyBooksBySessionId = useMemo(() => {
    const map: Record<string, StoryBook> = {};
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
  const diagnostics = useMemo(() => ({
    page: 'child-dashboard',
    routeChildId,
    activeChildId,
    storyCount: stories?.length ?? 0,
    storyBooks: storyBooks?.map((book) => {
      const completedAtValue = (book.pageGeneration?.lastCompletedAt as any)?.toDate?.();
      return {
        sessionId: book.storySessionId,
        status: book.pageGeneration?.status ?? null,
        pagesCount: book.pageGeneration?.pagesCount ?? null,
        lastCompletedAt: completedAtValue ? completedAtValue.toISOString() : null,
        imageStatus: book.imageGeneration?.status ?? null,
        imageReady: book.imageGeneration?.pagesReady ?? null,
        imageTotal: book.imageGeneration?.pagesTotal ?? null,
      };
    }) ?? [],
  }), [routeChildId, activeChildId, stories, storyBooks]);

  const handleReturnToParent = () => {
    switchToParentMode();
    showPinModal();
    router.push('/parent');
  };

  const handleCopyDiagnostics = () => {
    navigator.clipboard.writeText(`Page: child-dashboard\n\nDiagnostics\n${JSON.stringify(diagnostics, null, 2)}`);
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
            <CardTitle>Let’s Sign In</CardTitle>
            <CardDescription>A parent needs to sign in again.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><Link href="/login">Sign In</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeChildProfile) {
    return (
      <div className="container mx-auto px-4 py-16 text-center space-y-4">
        <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="text-2xl font-semibold">We couldn’t find that child.</h2>
        <p className="text-muted-foreground">
          Ask your grown-up to choose a profile from the parent section.
        </p>
        <Button variant="secondary" onClick={handleReturnToParent}>Back to Parent</Button>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-primary/10 to-background">
      <div className="container mx-auto px-4 py-10 space-y-10">
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Playing as</p>
          <h1 className="text-4xl font-headline">{activeChildProfile.displayName}</h1>
          <p className="text-muted-foreground">Pick a story to keep going or start a brand new adventure.</p>
        </div>

        {hasCelebration && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-emerald-900">
            🎉 One of your books is ready for printing! Ask your grown-up to show the finished pages.
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          <Button asChild size="lg" className="gap-2 text-lg">
            <Link href="/story/start">
              <Sparkles className="h-5 w-5" />
              Start a New Story
            </Link>
          </Button>
          <Button variant="ghost" onClick={handleReturnToParent}>
            Back to Parent
          </Button>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Your Stories</h2>
          {storiesLoading && !stories ? (
            <div className="flex items-center justify-center py-12">
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : stories && stories.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stories.map((story) => (
                <ChildStoryCard
                  key={story.id}
                  story={story}
                  storyBook={storyBooksBySessionId[story.id]}
                  bookLoading={isStoryBookLookupPending}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-10">
                <BookOpen className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">No stories yet. Tap “Start a New Story” to begin!</p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
    <Card className="mx-auto mt-10 max-w-4xl">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>Diagnostics</CardTitle>
          <CardDescription>Storybook page generation state for QA.</CardDescription>
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

    