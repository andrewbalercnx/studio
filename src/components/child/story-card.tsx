'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import type { Story } from '@/lib/types';
import { resolvePlaceholders } from '@/lib/resolve-placeholders';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { StoryTitleEditor } from '@/components/child/story-title-editor';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Volume2,
  VolumeX,
  Wand2,
  Loader2,
  Mic,
  RefreshCw,
  Users,
  BookOpen,
  Sparkles,
} from 'lucide-react';
import { ChildAvatarAnimation } from '@/components/child/child-avatar-animation';

type StoryCardProps = {
  story: Story;
  childId: string;
  isReading: boolean;
  isAudioGenerating: boolean;
  isActorAvatarGeneratingExternal?: boolean;
  /** Child's avatar animation URL (for displaying during AI loading) */
  childAvatarAnimationUrl?: string | null;
  /** Child's static avatar URL (fallback) */
  childAvatarUrl?: string | null;
  /** Display name for the story generator (from storyGenerators collection) */
  storyModeName?: string | null;
  onReadAloud: (story: Story) => void;
  onGenerateAudio: (storyId: string, forceRegenerate: boolean) => void;
  onGenerateActorAvatar?: (storyId: string, forceRegenerate: boolean) => void;
  onSaveTitle: (storyId: string, newTitle: string) => Promise<void>;
};

export function StoryCard({
  story,
  childId,
  isReading,
  isAudioGenerating,
  isActorAvatarGeneratingExternal,
  childAvatarAnimationUrl,
  childAvatarUrl,
  storyModeName,
  onReadAloud,
  onGenerateAudio,
  onGenerateActorAvatar,
  onSaveTitle,
}: StoryCardProps) {
  const [resolvedSynopsis, setResolvedSynopsis] = useState<string | null>(null);
  const [synopsisLoading, setSynopsisLoading] = useState(false);

  const createdAt = story.createdAt?.toDate
    ? story.createdAt.toDate()
    : new Date();

  const audioStatus = story.audioGeneration?.status;
  // Show AI Voice badge if we have audio URL OR status is ready (for consistency)
  const hasAiAudio = story.audioUrl || audioStatus === 'ready';
  const audioFailed = audioStatus === 'error';
  const noAudio = !audioStatus || audioStatus === 'idle';

  // Get display label for the story mode/generator
  // Use the passed-in generator name, or fall back to legacy hardcoded labels
  const getStoryModeLabel = (mode?: string): string | null => {
    // Legacy mappings for stories created before dynamic generators
    switch (mode) {
      case 'wizard': return 'Quick Story';
      case 'gemini3': return 'Adventure';
      case 'gemini4': return 'Deep Story';
      case 'friends': return 'Friends';
      case 'chat': return 'Classic';
      default: return null;
    }
  };
  // Prefer passed-in generator name, fall back to legacy lookup
  const storyModeLabel = storyModeName || getStoryModeLabel(story.storyMode);

  // Title generation status
  const titleStatus = story.titleGeneration?.status;
  const isTitleGenerating = titleStatus === 'generating' || titleStatus === 'pending';
  const hasTitleError = titleStatus === 'error';

  // Synopsis generation status
  const synopsisStatus = story.synopsisGeneration?.status;
  const isSynopsisGenerating = synopsisStatus === 'generating' || synopsisStatus === 'pending';
  const hasSynopsisError = synopsisStatus === 'error';
  const hasSynopsis = synopsisStatus === 'ready' && story.synopsis;

  // Actor avatar generation status
  const actorAvatarStatus = story.actorAvatarGeneration?.status;
  const isActorAvatarGenerating = actorAvatarStatus === 'generating' || actorAvatarStatus === 'pending' || isActorAvatarGeneratingExternal;
  const hasActorAvatar = actorAvatarStatus === 'ready' && story.actorAvatarUrl;
  const actorAvatarFailed = actorAvatarStatus === 'error';
  const noActorAvatar = !actorAvatarStatus || actorAvatarStatus === 'idle';

  // Resolve synopsis placeholders
  useEffect(() => {
    if (!story.synopsis) {
      setResolvedSynopsis(null);
      return;
    }

    const synopsis = story.synopsis;
    setSynopsisLoading(true);
    resolvePlaceholders(synopsis)
      .then((resolved) => {
        // resolvePlaceholders returns a Record<string, string> mapping original to resolved
        const resolvedText = resolved[synopsis] || synopsis;
        setResolvedSynopsis(resolvedText);
      })
      .catch((err) => {
        console.error('[StoryCard] Failed to resolve synopsis placeholders:', err);
        setResolvedSynopsis(synopsis);
      })
      .finally(() => {
        setSynopsisLoading(false);
      });
  }, [story.synopsis]);

  // Display title - show loading state if generating
  const displayTitle = story.metadata?.title || 'Untitled Story';

  return (
    <Card className="group flex flex-col border-2 border-primary/20 bg-primary/5 overflow-hidden">
      {/* Actor Avatar Header */}
      <div className="relative py-6 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
        {isActorAvatarGenerating ? (
          <div className="flex flex-col items-center gap-2">
            <ChildAvatarAnimation
              avatarAnimationUrl={childAvatarAnimationUrl}
              avatarUrl={childAvatarUrl}
              size="sm"
            />
            <span className="text-xs text-muted-foreground">Creating cast picture...</span>
          </div>
        ) : hasActorAvatar ? (
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-lg">
            <img
              src={story.actorAvatarUrl!}
              alt="Story cast"
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center border-4 border-white shadow-lg">
              <Users className="h-10 w-10" />
            </div>
            <span className="text-xs">{actorAvatarFailed ? 'Cast picture failed' : 'Story Cast'}</span>
            {onGenerateActorAvatar && (noActorAvatar || actorAvatarFailed) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onGenerateActorAvatar(story.id || '', actorAvatarFailed)}
                className="text-xs"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                {actorAvatarFailed ? 'Retry' : 'Generate'}
              </Button>
            )}
          </div>
        )}
      </div>

      <CardHeader className="pb-2">
        {isTitleGenerating ? (
          <div className="flex items-center gap-2">
            <ChildAvatarAnimation
              avatarAnimationUrl={childAvatarAnimationUrl}
              avatarUrl={childAvatarUrl}
              size="sm"
              className="flex-shrink-0"
            />
            <div className="flex-1">
              <Skeleton className="h-6 w-3/4" />
              <span className="text-xs text-muted-foreground">Creating title...</span>
            </div>
          </div>
        ) : (
          <StoryTitleEditor
            initialTitle={displayTitle}
            onSave={(newTitle) => onSaveTitle(story.id || '', newTitle)}
          />
        )}
        <CardDescription className="flex items-center gap-2 flex-wrap">
          <span>Created {formatDistanceToNow(createdAt, { addSuffix: true })}</span>
          {storyModeLabel && (
            <span className="inline-flex items-center text-xs text-purple-600 dark:text-purple-400">
              <Sparkles className="h-3 w-3 mr-1" />
              {storyModeLabel}
            </span>
          )}
          {hasAiAudio && (
            <span className="inline-flex items-center text-xs text-green-600 dark:text-green-400">
              <Mic className="h-3 w-3 mr-1" />
              AI Voice
            </span>
          )}
          {audioFailed && (
            <span className="inline-flex items-center text-xs text-amber-600 dark:text-amber-400">
              Audio failed
            </span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-grow space-y-3">
        {/* Synopsis */}
        {isSynopsisGenerating ? (
          <div className="flex items-center gap-2">
            <ChildAvatarAnimation
              avatarAnimationUrl={childAvatarAnimationUrl}
              avatarUrl={childAvatarUrl}
              size="sm"
              className="flex-shrink-0"
            />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <span className="text-xs text-muted-foreground">Writing synopsis...</span>
            </div>
          </div>
        ) : hasSynopsis ? (
          synopsisLoading ? (
            <Skeleton className="h-4 w-full" />
          ) : (
            <p className="text-sm text-foreground italic">
              "{resolvedSynopsis}"
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {story.storyText?.slice(0, 150)}
            {(story.storyText?.length ?? 0) > 150 ? '...' : ''}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pt-2">
        {/* Audio generating indicator with avatar animation */}
        {isAudioGenerating && (
          <div className="flex items-center gap-3 w-full p-2 bg-primary/5 rounded-lg">
            <ChildAvatarAnimation
              avatarAnimationUrl={childAvatarAnimationUrl}
              avatarUrl={childAvatarUrl}
              size="sm"
            />
            <div className="flex-1">
              <span className="text-sm font-medium">Creating narration...</span>
              <p className="text-xs text-muted-foreground">This may take a moment</p>
            </div>
          </div>
        )}

        {/* Read to Me button */}
        <div className="flex gap-2 w-full">
          <Button
            variant={isReading ? 'default' : 'secondary'}
            size="sm"
            className="flex-1"
            onClick={() => onReadAloud(story)}
            disabled={isAudioGenerating}
          >
            {isReading ? (
              <>
                <VolumeX className="mr-2 h-4 w-4" />
                Stop
              </>
            ) : isAudioGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Volume2 className="mr-2 h-4 w-4" />
                Read to Me
              </>
            )}
          </Button>
          {/* Show generate/regenerate button based on audio status */}
          {(noAudio || audioFailed) && !isAudioGenerating && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGenerateAudio(story.id || '', false)}
              title="Generate AI voice narration"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
          {hasAiAudio && !isAudioGenerating && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onGenerateAudio(story.id || '', true)}
              title="Regenerate AI voice"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* View Story button - links to child-friendly reader */}
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={`/child/${childId}/story/${story.id}/read`}>
            <BookOpen className="mr-2 h-4 w-4" />
            View Story
          </Link>
        </Button>

        {/* Create StoryBook button */}
        <Button asChild variant="default" size="sm" className="w-full">
          <Link href={`/child/${childId}/create-book/${story.id}`}>
            <Wand2 className="mr-2 h-4 w-4" />
            Create StoryBook
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
