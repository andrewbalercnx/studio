'use client';

import { use, useEffect, useRef, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { doc, collection, getDocs, limit, query, orderBy } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { StoryBookOutput, Story, StoryOutputPage } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { LoaderCircle, CheckCircle2, AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Moon, Clock } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/hooks/use-app-context';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';
import { DiagnosticsPanel } from '@/components/diagnostics-panel';
import { RefreshCw } from 'lucide-react';

// Calculate overall progress percentage (0-100)
function calculateOverallProgress(storybook: StoryBookOutput): number {
  const pageStatus = storybook.pageGeneration?.status || 'idle';
  const imageStatus = storybook.imageGeneration?.status || 'idle';
  const pagesReady = storybook.imageGeneration?.pagesReady || 0;
  const pagesTotal = storybook.imageGeneration?.pagesTotal || 1;

  // Phase 1: Page generation (0-25%)
  if (pageStatus === 'idle') return 0;
  if (pageStatus === 'running') return 12; // Mid-point of phase 1
  if (pageStatus === 'error' || pageStatus === 'rate_limited') return 0;

  // Pages ready, check images
  if (pageStatus === 'ready' && imageStatus === 'idle') return 25;

  // Phase 2: Image generation (25-100%)
  if (imageStatus === 'running' && pagesTotal > 0) {
    const imageProgress = (pagesReady / pagesTotal) * 75;
    return Math.round(25 + imageProgress);
  }

  if (imageStatus === 'ready') return 100;
  // For rate_limited or error, show partial progress
  if (imageStatus === 'error' || imageStatus === 'rate_limited') {
    return 25 + Math.round((pagesReady / Math.max(pagesTotal, 1)) * 75);
  }

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
  if (pageStatus === 'rate_limited') return 'The Story Wizard is taking a nap!';
  if (pageStatus === 'error') return 'Oops! Something went wrong with the pages.';

  if (pageStatus === 'ready' && imageStatus === 'idle') return 'Pages ready! Starting the art...';
  if (imageStatus === 'running') {
    return `Painting illustrations (${pagesReady} of ${pagesTotal} done)...`;
  }
  if (imageStatus === 'ready') return 'Your book is complete!';
  if (imageStatus === 'rate_limited') return 'The Story Wizard is taking a nap!';
  if (imageStatus === 'error') return 'Oops! Something went wrong with the pictures.';

  return 'Working on your book...';
}

// Format retry time in a child-friendly way
function formatRetryTime(retryAt: any): string {
  if (!retryAt) return 'soon';

  const retryDate = typeof retryAt.toDate === 'function' ? retryAt.toDate() : new Date(retryAt);
  const now = new Date();
  const diffMs = retryDate.getTime() - now.getTime();
  const diffMins = Math.max(0, Math.ceil(diffMs / (1000 * 60)));

  if (diffMins <= 0) return 'any moment now';
  if (diffMins < 60) return `in about ${diffMins} minutes`;

  const diffHours = Math.ceil(diffMins / 60);
  if (diffHours === 1) return 'in about an hour';
  return `in about ${diffHours} hours`;
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
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

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

  // Retry failed image generation
  const handleRetryImages = async () => {
    if (!storybook || isRetrying) return;

    setIsRetrying(true);
    hasTriggeredImages.current = true;

    try {
      const res = await fetch('/api/storybookV2/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId,
          storybookId,
          imageStylePrompt: storybook.imageStylePrompt,
          ...(storybook.imageWidthPx != null && { targetWidthPx: storybook.imageWidthPx }),
          ...(storybook.imageHeightPx != null && { targetHeightPx: storybook.imageHeightPx }),
        }),
      });

      const result = await res.json();

      if (result.ok) {
        toast({
          title: 'Retry Successful',
          description: 'All images are now complete!',
        });
      } else if (result.status === 'ready') {
        toast({
          title: 'Book Complete!',
          description: 'Your storybook is ready to read!',
        });
      } else {
        toast({
          title: 'Some Images Still Failed',
          description: result.errorMessage || 'Please try again later.',
          variant: 'destructive',
        });
        hasTriggeredImages.current = false;
      }
    } catch (err: any) {
      toast({
        title: 'Retry Failed',
        description: err.message || 'Please try again later.',
        variant: 'destructive',
      });
      hasTriggeredImages.current = false;
    } finally {
      setIsRetrying(false);
    }
  };

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
  const isRateLimited =
    storybook.pageGeneration?.status === 'rate_limited' ||
    storybook.imageGeneration?.status === 'rate_limited';
  const isComplete = storybook.imageGeneration?.status === 'ready';
  const errorMessage =
    storybook.pageGeneration?.lastErrorMessage ||
    storybook.imageGeneration?.lastErrorMessage;
  const retryAt =
    storybook.pageGeneration?.rateLimitRetryAt ||
    storybook.imageGeneration?.rateLimitRetryAt;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-headline text-primary">
            {isComplete ? 'Your Book is Ready!' : isRateLimited ? 'Taking a Little Break!' : 'Creating Your Book!'}
          </h1>
          <p className="text-xl text-muted-foreground">
            {isRateLimited
              ? 'The Story Wizard worked really hard and needs a quick rest!'
              : `${story?.metadata?.title || 'Your story'} is being turned into a beautiful book!`}
          </p>
        </div>

        {/* Progress Card */}
        <Card
          className={cn(
            'border-2',
            hasError && 'border-destructive/50 bg-destructive/5',
            isRateLimited && 'border-amber-500/50 bg-amber-50',
            isComplete && 'border-green-500/50 bg-green-50',
            !hasError && !isRateLimited && !isComplete && 'border-primary/50 bg-primary/5'
          )}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              {hasError ? (
                <AlertTriangle className="h-8 w-8 text-destructive" />
              ) : isRateLimited ? (
                <Moon className="h-8 w-8 text-amber-500" />
              ) : isComplete ? (
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              ) : (
                <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
              )}
              <div className="flex-1">
                <CardTitle className="text-xl">
                  {isRateLimited ? 'Wizard Nap Time' : 'Book Creation Progress'}
                </CardTitle>
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
                isRateLimited && 'bg-amber-100',
                isComplete && 'bg-green-100'
              )}
            />
            <div className="text-center">
              <p
                className={cn(
                  'text-4xl font-bold',
                  hasError && 'text-destructive',
                  isRateLimited && 'text-amber-600',
                  isComplete && 'text-green-600',
                  !hasError && !isRateLimited && !isComplete && 'text-primary'
                )}
              >
                {progress}%
              </p>
            </div>

            {/* Rate Limited Message */}
            {isRateLimited && (
              <div className="rounded-lg bg-amber-100 p-4 text-sm text-amber-800">
                <div className="flex items-center gap-2 font-medium">
                  <Clock className="h-4 w-4" />
                  <span>We&apos;ll try again {formatRetryTime(retryAt)}!</span>
                </div>
                <p className="mt-2">
                  Don&apos;t worry - your book is safe! The Story Wizard just needs a little rest.
                  We&apos;ll keep working on it automatically. Come back later to see your finished book!
                </p>
              </div>
            )}

            {/* Error Message */}
            {hasError && errorMessage && (
              <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Something went wrong:</p>
                <p>{errorMessage}</p>
              </div>
            )}

            {/* Diagnostics Toggle */}
            {storybook?.pageGeneration?.diagnostics && (
              <div className="pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="w-full text-muted-foreground text-xs"
                >
                  {showDiagnostics ? (
                    <>
                      <ChevronUp className="mr-1 h-3 w-3" />
                      Hide Diagnostics
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-1 h-3 w-3" />
                      Show Diagnostics
                    </>
                  )}
                </Button>
                {showDiagnostics && (
                  <pre className="mt-2 rounded-lg bg-muted p-3 text-xs overflow-auto max-h-64">
                    {JSON.stringify(storybook.pageGeneration.diagnostics, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fun Animation (when not complete/error/rate-limited) */}
        {!isComplete && !hasError && !isRateLimited && (
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

        {/* Rate Limited - Sleepy Wizard Animation */}
        {isRateLimited && (
          <div className="text-center space-y-4 pt-4">
            <div className="flex justify-center">
              <div className="relative">
                <Moon className="h-24 w-24 text-amber-400 animate-pulse" />
                <span className="absolute -top-2 -right-2 text-3xl">💤</span>
              </div>
            </div>
            <p className="text-lg text-amber-700 italic">
              Shhh... The Story Wizard is resting!
            </p>
            <p className="text-sm text-muted-foreground">
              Your book will be ready when you come back. Go play and check again later!
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

        {/* Rate Limited Actions */}
        {isRateLimited && (
          <div className="flex flex-col gap-3 items-center">
            <Button asChild size="lg" className="bg-amber-500 hover:bg-amber-600">
              <Link href={`/child/${childId}/books`}>
                Go to My Books
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              We&apos;ll notify you when your book is ready!
            </p>
          </div>
        )}

        {/* Error Actions */}
        {hasError && (
          <div className="flex flex-col gap-4 items-center">
            <Button
              onClick={handleRetryImages}
              disabled={isRetrying}
              size="lg"
              className="min-w-[200px]"
            >
              {isRetrying ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Try Again
                </>
              )}
            </Button>
            <p className="text-sm text-muted-foreground">
              {storybook?.imageGeneration?.pagesReady || 0} of {storybook?.imageGeneration?.pagesTotal || 0} images complete
            </p>
            <Button asChild variant="outline">
              <Link href={`/child/${childId}/stories`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to My Stories
              </Link>
            </Button>
          </div>
        )}

        {/* Back Link (when in progress) */}
        {!isComplete && !hasError && !isRateLimited && (
          <div className="text-center pt-4">
            <Button variant="ghost" asChild>
              <Link href={`/child/${childId}`}>Back to Dashboard</Link>
            </Button>
          </div>
        )}

        {/* Diagnostics Panel */}
        <DiagnosticsPanel
          pageName="book-generating"
          className="w-full mt-8"
          data={{
            childId,
            storybookId,
            storyId,
            progress,
            isComplete,
            hasError,
            isRateLimited,
            errorMessage: errorMessage || undefined,
            retryAt: retryAt ? formatRetryTime(retryAt) : undefined,
            storybook: storybook ? {
              storyOutputTypeId: storybook.storyOutputTypeId || null,
              imageStyleId: storybook.imageStyleId || null,
              printLayoutId: storybook.printLayoutId || null,
              imageWidthPx: storybook.imageWidthPx || null,
              imageHeightPx: storybook.imageHeightPx || null,
              pageGeneration: storybook.pageGeneration || null,
              imageGeneration: storybook.imageGeneration || null,
            } : null,
            story: story ? {
              title: story.metadata?.title || null,
              childId: story.childId || null,
            } : null,
          }}
        />
      </div>
    </div>
  );
}
