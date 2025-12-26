'use client';

import { use, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { Story, StorySession } from '@/lib/types';
import { LoaderCircle } from 'lucide-react';
import { WorkflowProgress } from '@/components/shared/workflow-progress';
import { useAppContext } from '@/hooks/use-app-context';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

export default function GeneratingPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.sessionId;
  const router = useRouter();
  const firestore = useFirestore();
  const { activeChildProfile } = useAppContext();
  const hasTriggeredPages = useRef(false);
  const hasTriggeredImages = useRef(false);

  // Load session and story
  const sessionRef = useMemo(() => (firestore ? doc(firestore, 'storySessions', sessionId) : null), [firestore, sessionId]);
  const storyRef = useMemo(() => (firestore ? doc(firestore, 'stories', sessionId) : null), [firestore, sessionId]);

  const { data: session, loading: sessionLoading } = useDocument<StorySession>(sessionRef);
  const { data: story, loading: storyLoading } = useDocument<Story>(storyRef);

  const pageStatus = story?.pageGeneration?.status ?? 'idle';
  const imageStatus = story?.imageGeneration?.status ?? 'idle';
  const imageReady = story?.imageGeneration?.pagesReady ?? 0;
  const imageTotal = story?.imageGeneration?.pagesTotal ?? 0;

  // Auto-trigger page generation if needed
  useEffect(() => {
    const shouldGeneratePages =
      session?.storyOutputTypeId &&
      session?.status === 'completed' &&
      story &&
      (!story.pageGeneration || story.pageGeneration.status === 'idle') &&
      !hasTriggeredPages.current;

    console.log('[Generating] Page generation check:', {
      hasOutputType: !!session?.storyOutputTypeId,
      sessionStatus: session?.status,
      hasStory: !!story,
      pageStatus: story?.pageGeneration?.status || 'no-status',
      hasTriggered: hasTriggeredPages.current,
      shouldGenerate: shouldGeneratePages
    });

    if (shouldGeneratePages) {
      hasTriggeredPages.current = true;
      console.log('[Generating] Auto-triggering page generation NOW');
      const generatePages = async () => {
        try {
          const response = await fetch('/api/storyBook/pages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: sessionId }),
          });
          const body = await response.json();
          if (!response.ok || !body.ok) {
            console.error('[Generating] Page generation failed:', body.errorMessage);
            hasTriggeredPages.current = false; // Allow retry on error
          } else {
            console.log('[Generating] Page generation started successfully');
          }
        } catch (err: any) {
          console.error('[Generating] Error calling page generation API:', err);
          hasTriggeredPages.current = false; // Allow retry on error
        }
      };
      generatePages();
    }
  }, [session?.storyOutputTypeId, session?.status, story?.pageGeneration?.status, sessionId, story, session]);

  // Auto-trigger image generation if needed
  useEffect(() => {
    const shouldGenerateImages =
      story?.selectedImageStyleId &&
      story?.pageGeneration?.status === 'ready' &&
      (!story.imageGeneration || story.imageGeneration.status === 'idle') &&
      !hasTriggeredImages.current;

    console.log('[Generating] Image generation check:', {
      hasImageStyle: !!story?.selectedImageStyleId,
      pageStatus: story?.pageGeneration?.status,
      imageStatus: story?.imageGeneration?.status || 'no-status',
      hasTriggered: hasTriggeredImages.current,
      shouldGenerate: shouldGenerateImages
    });

    if (shouldGenerateImages) {
      hasTriggeredImages.current = true;
      console.log('[Generating] Auto-triggering image generation NOW');
      const generateImages = async () => {
        try {
          const response = await fetch('/api/storyBook/images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storyId: sessionId }),
          });
          const body = await response.json();
          if (!response.ok || !body.ok) {
            console.error('[Generating] Image generation failed:', body.errorMessage);
            hasTriggeredImages.current = false; // Allow retry on error
          } else {
            console.log('[Generating] Image generation started successfully');
          }
        } catch (err: any) {
          console.error('[Generating] Error calling image generation API:', err);
          hasTriggeredImages.current = false; // Allow retry on error
        }
      };
      generateImages();
    }
  }, [story?.selectedImageStyleId, story?.pageGeneration?.status, story?.imageGeneration?.status, sessionId, story]);

  // Auto-redirect logic
  useEffect(() => {
    if (!story) return;

    // If pages are done and no image style selected, go to image style selection
    if (pageStatus === 'ready' && !story.selectedImageStyleId) {
      router.push(`/story/session/${sessionId}/select-image-style`);
      return;
    }

    // If everything is done, go back to session page
    if (pageStatus === 'ready' && imageStatus === 'ready') {
      router.push(`/story/session/${sessionId}`);
      return;
    }

    // If there's an error, redirect to session page after a delay
    if (pageStatus === 'error' || imageStatus === 'error') {
      const timer = setTimeout(() => {
        router.push(`/story/session/${sessionId}`);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [pageStatus, imageStatus, story?.selectedImageStyleId, sessionId, router, story]);

  if (sessionLoading || storyLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isGeneratingPages = pageStatus === 'running';
  const isGeneratingImages = imageStatus === 'running';

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-3xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-headline">Creating Your Storybook</h1>
          <p className="text-muted-foreground">
            Please wait while we prepare your magical adventure...
          </p>
        </div>

        <div className="space-y-6">
          {/* Page Generation Progress */}
          <WorkflowProgress
            title="Step 1: Creating Story Pages"
            description="Breaking your story into beautiful pages"
            status={pageStatus}
            errorMessage={story?.pageGeneration?.lastErrorMessage}
          />

          {/* Image Generation Progress */}
          {(pageStatus === 'ready' || isGeneratingImages) && (
            <WorkflowProgress
              title="Step 2: Generating Artwork"
              description="Creating magical illustrations for your story"
              status={imageStatus}
              currentStep={imageReady}
              totalSteps={imageTotal}
              errorMessage={story?.imageGeneration?.lastErrorMessage}
            />
          )}
        </div>

        {(isGeneratingPages || isGeneratingImages) && (
          <div className="text-center space-y-4 pt-8">
            <div className="flex justify-center">
              <ChildAvatarAnimation
                avatarAnimationUrl={activeChildProfile?.avatarAnimationUrl}
                avatarUrl={activeChildProfile?.avatarUrl}
                size="lg"
              />
            </div>
            <p className="text-lg text-muted-foreground italic">
              {isGeneratingPages && "The Story Wizard is working on your pages..."}
              {isGeneratingImages && "The Art Fairy is painting your pictures..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
