'use client';

import { use, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useDocument } from '@/lib/firestore-hooks';
import type { StoryBookOutput, Story } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoaderCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { WorkflowProgress } from '@/components/shared/workflow-progress';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/hooks/use-app-context';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

export default function StorybookGeneratingPage({
  params,
}: {
  params: Promise<{ storyId: string; storybookId: string }>;
}) {
  const resolvedParams = use(params);
  const { storyId, storybookId } = resolvedParams;
  const router = useRouter();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { activeChildProfile } = useAppContext();

  const hasTriggeredPages = useRef(false);
  const hasTriggeredImages = useRef(false);

  // Load storybook
  const storybookRef = useMemo(
    () => (firestore ? doc(firestore, 'stories', storyId, 'storybooks', storybookId) : null),
    [firestore, storyId, storybookId]
  );
  const { data: storybook, loading: storybookLoading } = useDocument<StoryBookOutput>(storybookRef);

  // Load story for context
  const storyRef = useMemo(() => (firestore ? doc(firestore, 'stories', storyId) : null), [firestore, storyId]);
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
              description: result.errorMessage,
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
              description: result.errorMessage,
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
        title: 'Storybook Complete!',
        description: 'Your storybook is ready to view.',
      });
      router.push(`/storybook/${storybookId}`);
    }
  }, [storybook?.imageGeneration?.status, storybookId, router, toast]);

  if (storybookLoading) {
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
            <CardTitle>Storybook Not Found</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/story/${storyId}`}>Back to Story</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pageStatus = storybook.pageGeneration?.status || 'idle';
  const imageStatus = storybook.imageGeneration?.status || 'idle';

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background py-10">
      <div className="container mx-auto px-4 max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-headline text-primary">Creating Your Storybook</h1>
          <p className="text-muted-foreground">
            {story?.metadata?.title || 'Your story'} is being turned into a beautiful book!
          </p>
        </div>

        <div className="space-y-4">
          {/* Step 1: Page Generation */}
          <WorkflowProgress
            title="Step 1: Creating Story Pages"
            description="Breaking your story into pages with text and image prompts"
            status={pageStatus}
            currentStep={pageStatus === 'ready' ? storybook.pageGeneration?.pagesCount : undefined}
            totalSteps={storybook.pageGeneration?.pagesCount}
            errorMessage={storybook.pageGeneration?.lastErrorMessage}
          />

          {/* Step 2: Image Generation */}
          <WorkflowProgress
            title="Step 2: Generating Artwork"
            description="Creating beautiful illustrations for each page"
            status={pageStatus !== 'ready' ? 'idle' : imageStatus}
            currentStep={storybook.imageGeneration?.pagesReady}
            totalSteps={storybook.imageGeneration?.pagesTotal}
            errorMessage={storybook.imageGeneration?.lastErrorMessage}
          />
        </div>

        {/* Fun Animation (when generating) */}
        {(pageStatus === 'running' || imageStatus === 'running') && (
          <div className="text-center space-y-4 pt-4">
            <div className="flex justify-center">
              <ChildAvatarAnimation
                avatarAnimationUrl={activeChildProfile?.avatarAnimationUrl}
                avatarUrl={activeChildProfile?.avatarUrl}
                size="lg"
              />
            </div>
            <p className="text-lg text-muted-foreground italic">
              {pageStatus === 'running' && "The Story Wizard is working on your pages..."}
              {imageStatus === 'running' && "The Art Fairy is painting your pictures..."}
            </p>
          </div>
        )}

        {/* Back link */}
        <div className="text-center pt-4">
          <Button variant="ghost" asChild>
            <Link href={`/story/${storyId}`}>Back to Story</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
