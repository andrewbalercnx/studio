'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../../../layout';
import type { Story, StorySession, StoryBookOutput } from '@/lib/types';
import { LoaderCircle, CheckCircle2, Wand2, Paintbrush, Music, Moon, Clock, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';
import Link from 'next/link';

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

export default function KidsGeneratingPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked } = useKidsPWA();

  // Check if this is the new model (storybookId in query params)
  const storybookId = searchParams.get('storybookId');
  const isNewModel = !!storybookId;

  const hasTriggeredPages = useRef(false);
  const hasTriggeredImages = useRef(false);
  const hasTriggeredAudio = useRef(false);

  // Load session (for legacy model)
  const sessionRef = useMemo(
    () => (firestore && !isNewModel ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId, isNewModel]
  );
  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);

  // Load story
  const storyRef = useMemo(
    () => (firestore ? doc(firestore, 'stories', sessionId) : null),
    [firestore, sessionId]
  );
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  // Load storybook (for new model)
  const storybookRef = useMemo(
    () => (firestore && isNewModel && storybookId ? doc(firestore, 'stories', sessionId, 'storybooks', storybookId) : null),
    [firestore, sessionId, storybookId, isNewModel]
  );
  const { data: storybook, loading: storybookLoading } = useDocument<StoryBookOutput>(storybookRef);

  // Get status from the appropriate source
  const pageStatus = isNewModel
    ? (storybook?.pageGeneration?.status ?? 'idle')
    : (story?.pageGeneration?.status ?? 'idle');
  const imageStatus = isNewModel
    ? (storybook?.imageGeneration?.status ?? 'idle')
    : (story?.imageGeneration?.status ?? 'idle');
  const audioStatus = story?.audioGeneration?.status ?? 'idle';

  const imageReady = isNewModel
    ? (storybook?.imageGeneration?.pagesReady ?? 0)
    : (story?.imageGeneration?.pagesReady ?? 0);
  const imageTotal = isNewModel
    ? (storybook?.imageGeneration?.pagesTotal ?? 0)
    : (story?.imageGeneration?.pagesTotal ?? 0);

  // Rate limiting info
  const isRateLimited = pageStatus === 'rate_limited' || imageStatus === 'rate_limited';
  const hasError = pageStatus === 'error' || imageStatus === 'error';
  const retryAt = isNewModel
    ? (storybook?.pageGeneration?.rateLimitRetryAt || storybook?.imageGeneration?.rateLimitRetryAt)
    : (story?.pageGeneration?.rateLimitRetryAt || story?.imageGeneration?.rateLimitRetryAt);
  const errorMessage = isNewModel
    ? (storybook?.pageGeneration?.lastErrorMessage || storybook?.imageGeneration?.lastErrorMessage)
    : (story?.pageGeneration?.lastErrorMessage || story?.imageGeneration?.lastErrorMessage);

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Auto-trigger page generation
  useEffect(() => {
    if (hasTriggeredPages.current) return;

    // For new model: check storybook status
    if (isNewModel && storybook?.pageGeneration?.status === 'idle') {
      hasTriggeredPages.current = true;
      console.log('[KidsGenerating] Auto-triggering page generation (new model)');

      fetch('/api/storybookV2/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: sessionId, storybookId }),
      })
        .then(res => res.json())
        .then(body => {
          if (!body.ok) {
            console.error('[KidsGenerating] Page generation failed:', body.errorMessage);
            hasTriggeredPages.current = false;
          }
        })
        .catch(err => {
          console.error('[KidsGenerating] Error calling page generation API:', err);
          hasTriggeredPages.current = false;
        });
    }
    // For legacy model: check session and story status
    else if (!isNewModel && session?.storyOutputTypeId && session?.status === 'completed' && story && (!story.pageGeneration || story.pageGeneration.status === 'idle')) {
      hasTriggeredPages.current = true;
      console.log('[KidsGenerating] Auto-triggering page generation (legacy model)');

      fetch('/api/storyBook/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: sessionId }),
      })
        .then(res => res.json())
        .then(body => {
          if (!body.ok) {
            console.error('[KidsGenerating] Page generation failed:', body.errorMessage);
            hasTriggeredPages.current = false;
          }
        })
        .catch(err => {
          console.error('[KidsGenerating] Error calling page generation API:', err);
          hasTriggeredPages.current = false;
        });
    }
  }, [isNewModel, storybook?.pageGeneration?.status, session?.storyOutputTypeId, session?.status, story?.pageGeneration?.status, sessionId, storybookId, story, session, storybook]);

  // Auto-trigger image generation
  useEffect(() => {
    if (hasTriggeredImages.current) return;

    // For new model
    if (isNewModel && storybook?.pageGeneration?.status === 'ready' && storybook?.imageGeneration?.status === 'idle') {
      hasTriggeredImages.current = true;
      console.log('[KidsGenerating] Auto-triggering image generation (new model)');

      fetch('/api/storybookV2/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: sessionId,
          storybookId,
          imageStylePrompt: storybook.imageStylePrompt,
          ...(storybook.imageWidthPx != null && { targetWidthPx: storybook.imageWidthPx }),
          ...(storybook.imageHeightPx != null && { targetHeightPx: storybook.imageHeightPx }),
        }),
      })
        .then(res => res.json())
        .then(body => {
          if (!body.ok) {
            console.error('[KidsGenerating] Image generation failed:', body.errorMessage);
            hasTriggeredImages.current = false;
          }
        })
        .catch(err => {
          console.error('[KidsGenerating] Error calling image generation API:', err);
          hasTriggeredImages.current = false;
        });
    }
    // For legacy model
    else if (!isNewModel && story?.selectedImageStyleId && story?.pageGeneration?.status === 'ready' && (!story.imageGeneration || story.imageGeneration.status === 'idle')) {
      hasTriggeredImages.current = true;
      console.log('[KidsGenerating] Auto-triggering image generation (legacy model)');

      fetch('/api/storyBook/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: sessionId }),
      })
        .then(res => res.json())
        .then(body => {
          if (!body.ok) {
            console.error('[KidsGenerating] Image generation failed:', body.errorMessage);
            hasTriggeredImages.current = false;
          }
        })
        .catch(err => {
          console.error('[KidsGenerating] Error calling image generation API:', err);
          hasTriggeredImages.current = false;
        });
    }
  }, [isNewModel, storybook?.pageGeneration?.status, storybook?.imageGeneration?.status, storybook?.imageStylePrompt, storybook?.imageWidthPx, storybook?.imageHeightPx, story?.selectedImageStyleId, story?.pageGeneration?.status, story?.imageGeneration?.status, sessionId, storybookId, story, storybook]);

  // Auto-trigger audio generation (legacy model only - new model handles audio separately)
  useEffect(() => {
    if (isNewModel || hasTriggeredAudio.current) return;

    if (story?.pageGeneration?.status === 'ready' && (!story.audioGeneration || story.audioGeneration.status === 'idle')) {
      hasTriggeredAudio.current = true;
      console.log('[KidsGenerating] Auto-triggering audio generation');

      fetch('/api/storyBook/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: sessionId }),
      })
        .then(res => res.json())
        .then(body => {
          if (!body.ok) {
            console.error('[KidsGenerating] Audio generation failed:', body.errorMessage);
            hasTriggeredAudio.current = false;
          }
        })
        .catch(err => {
          console.error('[KidsGenerating] Error calling audio generation API:', err);
          hasTriggeredAudio.current = false;
        });
    }
  }, [isNewModel, story?.pageGeneration?.status, story?.audioGeneration?.status, sessionId, story]);

  // Auto-redirect when complete
  useEffect(() => {
    // For new model: redirect to books list when images are ready
    if (isNewModel && storybook?.imageGeneration?.status === 'ready') {
      router.push('/kids/books');
      return;
    }

    // For legacy model
    if (!isNewModel && story) {
      // If pages are done and no image style selected, go back to style selection
      if (story.pageGeneration?.status === 'ready' && !story.selectedImageStyleId) {
        router.push(`/kids/create/${sessionId}/style`);
        return;
      }

      // If everything is done, go to the read page (legacy path)
      if (story.pageGeneration?.status === 'ready' && story.imageGeneration?.status === 'ready') {
        router.push(`/kids/read/${sessionId}`);
        return;
      }
    }
  }, [isNewModel, storybook?.imageGeneration?.status, story?.pageGeneration?.status, story?.imageGeneration?.status, story?.selectedImageStyleId, sessionId, router, story, storybook]);

  // Loading state
  const isLoading = userLoading || storyLoading || (isNewModel ? storybookLoading : sessionLoading);
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-orange-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  const isGeneratingPages = pageStatus === 'running';
  const isGeneratingImages = imageStatus === 'running';
  const isGeneratingAudio = audioStatus === 'generating' || audioStatus === 'pending';
  const imagesProgress = imageTotal > 0 ? Math.round((imageReady / imageTotal) * 100) : 0;
  const isComplete = isNewModel
    ? storybook?.imageGeneration?.status === 'ready'
    : (story?.pageGeneration?.status === 'ready' && story?.imageGeneration?.status === 'ready');

  // Rate limited state
  if (isRateLimited) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
        <header className="px-4 py-6 text-center">
          <h1 className="text-2xl font-bold text-amber-900">
            Taking a Little Break!
          </h1>
          <p className="text-amber-700 mt-1">
            The Story Wizard worked really hard and needs a quick rest!
          </p>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8 gap-8">
          <div className="relative">
            <Moon className="h-24 w-24 text-amber-400 animate-pulse" />
            <span className="absolute -top-2 -right-2 text-3xl">💤</span>
          </div>

          <div className="w-full max-w-sm space-y-4">
            <div className="p-4 rounded-2xl border-2 border-amber-300 bg-amber-50">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-amber-700" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900">Wizard Nap Time</h3>
                  <p className="text-sm text-amber-700">
                    We'll try again {formatRetryTime(retryAt)}!
                  </p>
                </div>
              </div>
              <p className="text-sm text-amber-600 mt-2">
                Don't worry - your book is safe! The Story Wizard just needs a little rest.
                We'll keep working on it automatically. Come back later to see your finished book!
              </p>
            </div>
          </div>

          <div className="text-center space-y-2">
            <p className="text-lg text-amber-800 italic">
              Shhh... The Story Wizard is resting!
            </p>
            <p className="text-sm text-amber-600">
              Your book will be ready when you come back. Go play and check again later!
            </p>
          </div>

          <Button asChild className="bg-amber-500 hover:bg-amber-600">
            <Link href="/kids/books">
              Go to My Books
            </Link>
          </Button>
        </main>
      </div>
    );
  }

  // Error state
  if (hasError) {
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
        <header className="px-4 py-6 text-center">
          <h1 className="text-2xl font-bold text-red-800">
            Oops! Something Went Wrong
          </h1>
          <p className="text-red-600 mt-1">
            The Story Wizard ran into a problem
          </p>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8 gap-8">
          <AlertTriangle className="h-20 w-20 text-red-400" />

          {errorMessage && (
            <div className="w-full max-w-sm p-4 rounded-2xl border-2 border-red-200 bg-red-50">
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
          )}

          <div className="flex gap-4">
            <Button asChild variant="outline">
              <Link href="/kids/stories">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Stories
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header */}
      <header className="px-4 py-6 text-center">
        <h1 className="text-2xl font-bold text-amber-900">
          {isComplete ? 'Your Book is Ready!' : 'Creating Your Book'}
        </h1>
        <p className="text-amber-700 mt-1">
          {isComplete ? 'Time to read your amazing story!' : 'The magic is happening...'}
        </p>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8 gap-8">
        {/* Animated character */}
        <ChildAvatarAnimation
          avatarAnimationUrl={childProfile?.avatarAnimationUrl}
          avatarUrl={childProfile?.avatarUrl}
          size="lg"
        />

        {/* Progress steps */}
        <div className="w-full max-w-sm space-y-4">
          {/* Step 1: Pages */}
          <ProgressStep
            icon={<Wand2 className="h-5 w-5" />}
            title="Writing Pages"
            status={pageStatus}
            message={
              pageStatus === 'running'
                ? 'Breaking your story into pages...'
                : pageStatus === 'ready'
                  ? 'Pages ready!'
                  : 'Waiting to start...'
            }
          />

          {/* Step 2: Images */}
          {(pageStatus === 'ready' || isGeneratingImages || imageStatus === 'ready') && (
            <ProgressStep
              icon={<Paintbrush className="h-5 w-5" />}
              title="Painting Pictures"
              status={imageStatus}
              progress={imagesProgress}
              message={
                imageStatus === 'running'
                  ? `Creating picture ${imageReady + 1} of ${imageTotal}...`
                  : imageStatus === 'ready'
                    ? 'All pictures done!'
                    : 'Getting ready...'
              }
            />
          )}

          {/* Step 3: Audio (legacy model only) */}
          {!isNewModel && (pageStatus === 'ready' && (isGeneratingAudio || audioStatus === 'ready')) && (
            <ProgressStep
              icon={<Music className="h-5 w-5" />}
              title="Recording Narration"
              status={audioStatus === 'ready' ? 'ready' : audioStatus === 'generating' || audioStatus === 'pending' ? 'running' : 'idle'}
              message={
                isGeneratingAudio
                  ? 'Recording the story...'
                  : audioStatus === 'ready'
                    ? 'Narration ready!'
                    : 'Getting ready...'
              }
            />
          )}
        </div>

        {/* Fun waiting message */}
        {!isComplete && (
          <div className="text-center space-y-2">
            <p className="text-lg text-amber-800 font-medium">
              {isGeneratingPages && 'The Story Wizard is preparing your pages...'}
              {isGeneratingImages && 'The Art Fairy is painting your pictures...'}
              {isGeneratingAudio && 'The Voice Fairy is recording...'}
              {!isGeneratingPages && !isGeneratingImages && !isGeneratingAudio && pageStatus !== 'ready' && 'Getting everything ready...'}
            </p>
            <p className="text-sm text-amber-600">
              This might take a few minutes
            </p>
          </div>
        )}

        {/* Complete message with action */}
        {isComplete && (
          <div className="text-center space-y-4">
            <p className="text-2xl">🎉</p>
            <p className="text-lg text-amber-800">Your book is ready to read!</p>
            <Button asChild size="lg" className="bg-amber-500 hover:bg-amber-600">
              <Link href="/kids/books">Go to My Books</Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

// Progress step component
function ProgressStep({
  icon,
  title,
  status,
  progress,
  message,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  progress?: number;
  message: string;
}) {
  const isRunning = status === 'running';
  const isReady = status === 'ready';

  return (
    <div
      className={cn(
        'p-4 rounded-2xl border-2 transition-all',
        isRunning && 'border-amber-400 bg-amber-50',
        isReady && 'border-green-400 bg-green-50',
        !isRunning && !isReady && 'border-gray-200 bg-white/50'
      )}
    >
      <div className="flex items-center gap-3 mb-2">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            isRunning && 'bg-amber-200 text-amber-700',
            isReady && 'bg-green-200 text-green-700',
            !isRunning && !isReady && 'bg-gray-200 text-gray-500'
          )}
        >
          {isRunning ? (
            <LoaderCircle className="h-5 w-5 animate-spin" />
          ) : isReady ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            icon
          )}
        </div>
        <div className="flex-1">
          <h3
            className={cn(
              'font-semibold',
              isRunning && 'text-amber-900',
              isReady && 'text-green-900',
              !isRunning && !isReady && 'text-gray-500'
            )}
          >
            {title}
          </h3>
          <p
            className={cn(
              'text-sm',
              isRunning && 'text-amber-700',
              isReady && 'text-green-700',
              !isRunning && !isReady && 'text-gray-400'
            )}
          >
            {message}
          </p>
        </div>
      </div>
      {isRunning && progress !== undefined && (
        <Progress value={progress} className="h-2 bg-amber-100" />
      )}
    </div>
  );
}
