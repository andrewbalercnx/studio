'use client';

import { use, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { doc, collection, getDocs, limit, query, orderBy } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { StoryBookOutput, Story, StoryOutputPage } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { LoaderCircle, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/hooks/use-app-context';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

// Calculate overall progress percentage (0-100)
function calculateOverallProgress(storybook: StoryBookOutput): number {
  const pageStatus = storybook.pageGeneration?.status || 'idle';
  const imageStatus = storybook.imageGeneration?.status || 'idle';
  const pagesReady = storybook.imageGeneration?.pagesReady || 0;
  const pagesTotal = storybook.imageGeneration?.pagesTotal || 1;

  // Phase 1: Page generation (0-25%)
  if (pageStatus === 'idle') return 0;
  if (pageStatus === 'running') return 12; // Mid-point of phase 1
  if (pageStatus === 'error') return 0;

  // Pages ready, check images
  if (pageStatus === 'ready' && imageStatus === 'idle') return 25;

  // Phase 2: Image generation (25-100%)
  if (imageStatus === 'running' && pagesTotal > 0) {
    const imageProgress = (pagesReady / pagesTotal) * 75;
    return Math.round(25 + imageProgress);
  }

  if (imageStatus === 'ready') return 100;
  if (imageStatus === 'error') return 25 + Math.round((pagesReady / Math.max(pagesTotal, 1)) * 75);

  return 25;
}

// Get friendly status message
function getStatusMessage(storybook: StoryBookOutput): string {
  const pageStatus = storybook.pageGeneration?.status || 'idle';
  const imageStatus = storybook.imageGeneration?.status || 'idle';
  const pagesReady = storybook.imageGeneration?.pagesReady || 0;
  const pagesTotal = storybook.imageGeneration?.pagesTotal || 0;

  if (pageStatus === 'idle') return 'Getting ready to create your book...';
  if (pageStatus === 'running') return 'Creating story pages...';
  if (pageStatus === 'error') return 'Oops! Something went wrong with the pages.';

  if (pageStatus === 'ready' && imageStatus === 'idle') return 'Pages ready! Starting the art...';
  if (imageStatus === 'running') {
    return `Painting illustrations (${pagesReady} of ${pagesTotal} done)...`;
  }
  if (imageStatus === 'ready') return 'Your book is complete!';
  if (imageStatus === 'error') return 'Oops! Something went wrong with the pictures.';

  return 'Working on your book...';
}

export default function BookGeneratingPage({
  params,
}: {
  params: Promise<{ childId: string; storybookId: string }>;
}) {
  const resolvedParams = use(params);
  const { childId, storybookId } = resolvedParams;
  const router = useRouter();
  const searchParams = useSearchParams();
  const storyId = searchParams.get('storyId') || storybookId; // Fall back to storybookId
  const firestore = useFirestore();
  const { user, idTokenResult, loading: userLoading } = useUser();
  const { toast } = useToast();
  const { activeChildProfile } = useAppContext();

  const hasTriggeredPages = useRef(false);
  const hasTriggeredImages = useRef(false);

  // Load storybook (only when authenticated and auth token is ready)
  // We wait for idTokenResult to ensure Firebase auth is fully synced with Firestore
  const storybookRef = useMemo(
    () => (firestore && storyId && user && !userLoading && idTokenResult ? doc(firestore, 'stories', storyId, 'storybooks', storybookId) : null),
    [firestore, storyId, storybookId, user, userLoading, idTokenResult]
  );
  const { data: storybook, loading: storybookLoading } = useDocument<StoryBookOutput>(storybookRef);

  // Load story for title (only when authenticated and auth token is ready)
  const storyRef = useMemo(
    () => (firestore && storyId && user && !userLoading && idTokenResult ? doc(firestore, 'stories', storyId) : null),
    [firestore, storyId, user, userLoading, idTokenResult]
  );
  const { data: story } = useDocument<Story>(storyRef);

  // Auto-trigger page generation
  useEffect(() => {
    const shouldGeneratePages =
      storybook &&
      storybook.pageGeneration?.status === 'idle' &&
      !hasTriggeredPages.current;

    if (shouldGeneratePages) {
      hasTriggeredPages.current = true;
      console.log('[Generating] Auto-triggering page generation for storybook:', storybookId);

      fetch('/api/storybookV2/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId,
          storybookId,
        }),
      })
        .then((res) => res.json())
        .then((result) => {
          if (!result.ok) {
            hasTriggeredPages.current = false;
            toast({
              title: 'Page Generation Failed',
              description: result.errorMessage || 'Could not create pages',
              variant: 'destructive',
            });
          }
        })
        .catch((err) => {
          hasTriggeredPages.current = false;
          toast({
            title: 'Error',
            description: err.message,
            variant: 'destructive',
          });
        });
    }
  }, [storybook?.pageGeneration?.status, storyId, storybookId, toast]);

  // Auto-trigger image generation when pages are ready
  useEffect(() => {
    const shouldGenerateImages =
      storybook &&
      storybook.pageGeneration?.status === 'ready' &&
      storybook.imageGeneration?.status === 'idle' &&
      !hasTriggeredImages.current;

    if (shouldGenerateImages) {
      hasTriggeredImages.current = true;
      console.log('[Generating] Auto-triggering image generation for storybook:', storybookId);

      fetch('/api/storybookV2/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId,
          storybookId,
          imageStylePrompt: storybook.imageStylePrompt,
          ...(storybook.imageWidthPx != null && { targetWidthPx: storybook.imageWidthPx }),
          ...(storybook.imageHeightPx != null && { targetHeightPx: storybook.imageHeightPx }),
        }),
      })
        .then((res) => res.json())
        .then((result) => {
          if (!result.ok) {
            hasTriggeredImages.current = false;
            toast({
              title: 'Image Generation Failed',
              description: result.errorMessage || 'Could not create pictures',
              variant: 'destructive',
            });
          }
        })
        .catch((err) => {
          hasTriggeredImages.current = false;
          toast({
            title: 'Error',
            description: err.message,
            variant: 'destructive',
          });
        });
    }
  }, [
    storybook?.pageGeneration?.status,
    storybook?.imageGeneration?.status,
    storybook?.imageStylePrompt,
    storybook?.imageWidthPx,
    storybook?.imageHeightPx,
    storyId,
    storybookId,
    toast,
  ]);

  // Auto-redirect when complete
  useEffect(() => {
    if (storybook?.imageGeneration?.status === 'ready') {
      toast({
        title: 'Book Complete!',
        description: 'Your storybook is ready to read!',
      });
      // Redirect to My Books page
      router.push(`/child/${childId}/books`);
    }
  }, [storybook?.imageGeneration?.status, childId, router, toast]);

  if (userLoading || storybookLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!storybook) {
    return (
      <div className="container mx-auto flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Book Not Found</CardTitle>
            <CardDescription>We couldn't find that book.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/child/${childId}/stories`}>Back to My Stories</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progress = calculateOverallProgress(storybook);
  const statusMessage = getStatusMessage(storybook);
  const hasError =
    storybook.pageGeneration?.status === 'error' ||
    storybook.imageGeneration?.status === 'error';
  const isComplete = storybook.imageGeneration?.status === 'ready';
  const errorMessage =
    storybook.pageGeneration?.lastErrorMessage ||
    storybook.imageGeneration?.lastErrorMessage;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-headline text-primary">
            {isComplete ? 'Your Book is Ready!' : 'Creating Your Book!'}
          </h1>
          <p className="text-xl text-muted-foreground">
            {story?.metadata?.title || 'Your story'} is being turned into a beautiful book!
          </p>
        </div>

        {/* Progress Card */}
        <Card
          className={cn(
            'border-2',
            hasError && 'border-destructive/50 bg-destructive/5',
            isComplete && 'border-green-500/50 bg-green-50',
            !hasError && !isComplete && 'border-primary/50 bg-primary/5'
          )}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              {hasError ? (
                <AlertTriangle className="h-8 w-8 text-destructive" />
              ) : isComplete ? (
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              ) : (
                <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
              )}
              <div className="flex-1">
                <CardTitle className="text-xl">Book Creation Progress</CardTitle>
                <CardDescription>{statusMessage}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={progress}
              className={cn(
                'h-4',
                hasError && 'bg-destructive/20',
                isComplete && 'bg-green-100'
              )}
            />
            <div className="text-center">
              <p
                className={cn(
                  'text-4xl font-bold',
                  hasError && 'text-destructive',
                  isComplete && 'text-green-600',
                  !hasError && !isComplete && 'text-primary'
                )}
              >
                {progress}%
              </p>
            </div>

            {/* Error Message */}
            {hasError && errorMessage && (
              <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Something went wrong:</p>
                <p>{errorMessage}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fun Animation (when not complete/error) */}
        {!isComplete && !hasError && (
          <div className="text-center space-y-4 pt-4">
            <div className="flex justify-center">
              <ChildAvatarAnimation
                avatarAnimationUrl={activeChildProfile?.avatarAnimationUrl}
                avatarUrl={activeChildProfile?.avatarUrl}
                size="lg"
              />
            </div>
            <p className="text-lg text-muted-foreground italic">
              The Story Wizard is working their magic...
            </p>
            <p className="text-sm text-muted-foreground">
              This might take a few minutes. You can stay here or come back later!
            </p>
          </div>
        )}

        {/* Complete Message */}
        {isComplete && (
          <div className="text-center space-y-4">
            <p className="text-2xl">🎉</p>
            <p className="text-lg">Your book is ready to read!</p>
            <Button asChild size="lg">
              <Link href={`/child/${childId}/books`}>Go to My Books</Link>
            </Button>
          </div>
        )}

        {/* Error Actions */}
        {hasError && (
          <div className="flex gap-4 justify-center">
            <Button asChild variant="outline">
              <Link href={`/child/${childId}/stories`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to My Stories
              </Link>
            </Button>
          </div>
        )}

        {/* Back Link (when in progress) */}
        {!isComplete && !hasError && (
          <div className="text-center pt-4">
            <Button variant="ghost" asChild>
              <Link href={`/child/${childId}`}>Back to Dashboard</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
