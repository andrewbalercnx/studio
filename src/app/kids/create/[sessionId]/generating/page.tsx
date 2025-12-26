'use client';

import { use, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/firebase/auth/use-user';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import { useKidsPWA } from '../../../layout';
import type { Story, StorySession } from '@/lib/types';
import { LoaderCircle, CheckCircle2, Wand2, Paintbrush, Music } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

export default function KidsGeneratingPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const firestore = useFirestore();
  const { childId, childProfile, isLocked } = useKidsPWA();

  const hasTriggeredPages = useRef(false);
  const hasTriggeredImages = useRef(false);
  const hasTriggeredAudio = useRef(false);

  // Load session and story
  const sessionRef = useMemo(
    () => (firestore ? doc(firestore, 'storySessions', sessionId) : null),
    [firestore, sessionId]
  );
  const storyRef = useMemo(
    () => (firestore ? doc(firestore, 'stories', sessionId) : null),
    [firestore, sessionId]
  );

  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  const pageStatus = story?.pageGeneration?.status ?? 'idle';
  const imageStatus = story?.imageGeneration?.status ?? 'idle';
  const audioStatus = story?.audioGeneration?.status ?? 'idle';
  const imageReady = story?.imageGeneration?.pagesReady ?? 0;
  const imageTotal = story?.imageGeneration?.pagesTotal ?? 0;

  // Redirect if not set up
  useEffect(() => {
    if (!userLoading && (!user || !isLocked || !childId)) {
      router.replace('/kids');
    }
  }, [userLoading, user, isLocked, childId, router]);

  // Auto-trigger page generation
  useEffect(() => {
    const shouldGeneratePages =
      session?.storyOutputTypeId &&
      session?.status === 'completed' &&
      story &&
      (!story.pageGeneration || story.pageGeneration.status === 'idle') &&
      !hasTriggeredPages.current;

    if (shouldGeneratePages) {
      hasTriggeredPages.current = true;
      const generatePages = async () => {
        try {
          const response = await fetch('/api/storyBook/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: sessionId }),
          });
          const body = await response.json();
          if (!response.ok || !body.ok) {
            console.error('[KidsGenerating] Page generation failed:', body.errorMessage);
            hasTriggeredPages.current = false;
          }
        } catch (err: any) {
          console.error('[KidsGenerating] Error calling page generation API:', err);
          hasTriggeredPages.current = false;
        }
      };
      generatePages();
    }
  }, [session?.storyOutputTypeId, session?.status, story?.pageGeneration?.status, sessionId, story, session]);

  // Auto-trigger image generation
  useEffect(() => {
    const shouldGenerateImages =
      story?.selectedImageStyleId &&
      story?.pageGeneration?.status === 'ready' &&
      (!story.imageGeneration || story.imageGeneration.status === 'idle') &&
      !hasTriggeredImages.current;

    if (shouldGenerateImages) {
      hasTriggeredImages.current = true;
      const generateImages = async () => {
        try {
          const response = await fetch('/api/storyBook/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: sessionId }),
          });
          const body = await response.json();
          if (!response.ok || !body.ok) {
            console.error('[KidsGenerating] Image generation failed:', body.errorMessage);
            hasTriggeredImages.current = false;
          }
        } catch (err: any) {
          console.error('[KidsGenerating] Error calling image generation API:', err);
          hasTriggeredImages.current = false;
        }
      };
      generateImages();
    }
  }, [story?.selectedImageStyleId, story?.pageGeneration?.status, story?.imageGeneration?.status, sessionId, story]);

  // Auto-trigger audio generation
  useEffect(() => {
    const shouldGenerateAudio =
      story?.pageGeneration?.status === 'ready' &&
      (!story.audioGeneration || story.audioGeneration.status === 'idle') &&
      !hasTriggeredAudio.current;

    if (shouldGenerateAudio) {
      hasTriggeredAudio.current = true;
      const generateAudio = async () => {
        try {
          const response = await fetch('/api/storyBook/audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: sessionId }),
          });
          const body = await response.json();
          if (!response.ok || !body.ok) {
            console.error('[KidsGenerating] Audio generation failed:', body.errorMessage);
            hasTriggeredAudio.current = false;
          }
        } catch (err: any) {
          console.error('[KidsGenerating] Error calling audio generation API:', err);
          hasTriggeredAudio.current = false;
        }
      };
      generateAudio();
    }
  }, [story?.pageGeneration?.status, story?.audioGeneration?.status, sessionId, story]);

  // Auto-redirect when complete
  useEffect(() => {
    if (!story) return;

    // If pages are done and no image style selected, go back to style selection
    if (pageStatus === 'ready' && !story.selectedImageStyleId) {
      router.push(`/kids/create/${sessionId}/style`);
      return;
    }

    // If everything is done, go to the read page
    if (pageStatus === 'ready' && imageStatus === 'ready') {
      router.push(`/kids/read/${sessionId}`);
      return;
    }
  }, [pageStatus, imageStatus, story?.selectedImageStyleId, sessionId, router, story]);

  // Loading state
  if (userLoading || sessionLoading || storyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  const isGeneratingPages = pageStatus === 'running';
  const isGeneratingImages = imageStatus === 'running';
  const isGeneratingAudio = audioStatus === 'generating' || audioStatus === 'pending';
  const imagesProgress = imageTotal > 0 ? Math.round((imageReady / imageTotal) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      {/* Header */}
      <header className="px-4 py-6 text-center">
        <h1 className="text-2xl font-bold text-amber-900">
          Creating Your Book
        </h1>
        <p className="text-amber-700 mt-1">
          The magic is happening...
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
          {(pageStatus === 'ready' || isGeneratingImages) && (
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

          {/* Step 3: Audio (optional) */}
          {(pageStatus === 'ready' && (isGeneratingAudio || audioStatus === 'ready')) && (
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
