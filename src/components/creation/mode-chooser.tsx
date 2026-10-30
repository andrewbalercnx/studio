'use client';

/**
 * "How do you want to create your story?" — the one mode chooser for the kids
 * PWA and the web child shell (slice 5.4). The list comes from the server
 * (`GET /api/creation-modes`, kid-safe presentation); a tap starts the Story
 * with `POST /api/stories` (one idempotency key per child + mode, so a double
 * tap starts one Story) and hands the new Story's id to the caller.
 */
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, LoaderCircle, MessageCircle, Sparkles, Star, Users, Wand2, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { StoriesLeftBadge } from '@/components/entitlements/entitlement-summary';
import { OnboardingTipTrigger } from '@/components/onboarding/onboarding-tip-trigger';
import { useCreateStory, useCreationModes } from '@/hooks/use-stories';
import { kidSafeMessage, StoryApiError } from '@/lib/stories/api';
import type { CreationModeView } from '@/lib/stories/types';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Wand2,
  wand: Wand2,
  MessageCircle,
  chat: MessageCircle,
  Sparkles,
  sparkles: Sparkles,
  BookOpen,
  book: BookOpen,
  Users,
  users: Users,
  Star,
  star: Star,
  Compass,
  compass: Compass,
};

function ModeIcon({ iconName, className }: { iconName: string | null; className?: string }) {
  const Icon = (iconName && ICON_MAP[iconName]) || Sparkles;
  return <Icon className={className} />;
}

function ModeCard({ mode, onClick, disabled }: { mode: CreationModeView; onClick: () => void; disabled?: boolean }) {
  // The mode's stored gradient is a pale card background ('from-purple-50 to-pink-50'),
  // not a tile colour: as the tile it left the white icon on white.
  const cardBackground = mode.gradient ? `bg-gradient-to-br ${mode.gradient}` : 'bg-white';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid="mode-card"
      data-mode-id={mode.modeId}
      className={`w-full text-left p-6 rounded-3xl bg-white ${cardBackground} border-2 border-amber-200 hover:border-amber-400 hover:shadow-xl active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
          <ModeIcon iconName={mode.icon} className="h-8 w-8 text-white" />
        </div>
        <div className="flex-1">
          {mode.recommended && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-semibold text-amber-800 mb-1">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              Recommended for first-timers
            </span>
          )}
          <h3 className="text-xl font-bold text-gray-900">{mode.name}</h3>
          <p className="text-gray-600 text-sm mt-1">{mode.description}</p>
        </div>
      </div>
    </button>
  );
}

export type ModeChooserProps = {
  childId: string;
  child?: { displayName?: string | null; avatarUrl?: string | null } | null;
  /** Where the back arrow and "Go Back Home" lead. */
  homeHref: string;
  /** Called with the new (or repeated) Story's id; the caller opens the play view. */
  onCreated: (storyId: string) => void;
};

export function ModeChooser({ childId, child, homeHref, onCreated }: ModeChooserProps) {
  const { modes, loading, error: loadError, reload } = useCreationModes();
  const { createStory, pending } = useCreateStory();
  const [chosen, setChosen] = useState<CreationModeView | null>(null);
  const [error, setError] = useState<{ message: string; outOfStories: boolean } | null>(null);

  const start = async (mode: CreationModeView) => {
    if (pending) return;
    setChosen(mode);
    setError(null);
    try {
      const result = await createStory({ childId, modeId: mode.modeId });
      // Funnel: story creation started (ids/enums only — no PII).
      if (result.created) track(ANALYTICS_EVENTS.storyStarted, { sessionId: result.storyId, storyTypeId: mode.modeId });
      onCreated(result.storyId);
    } catch (err) {
      console.error('[ModeChooser] Could not start the story', err);
      setError({
        message: kidSafeMessage(err),
        outOfStories: err instanceof StoryApiError && err.code === 'ENTITLEMENT_LIMIT',
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
        <p className="text-lg text-amber-800 font-medium text-center">Loading...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4 text-center">
        <div className="text-5xl">🧙💤</div>
        <h1 className="text-2xl font-bold text-amber-900">The story maker is waking up!</h1>
        <p className="text-amber-700">{kidSafeMessage(loadError)}</p>
        <div className="flex gap-3">
          <Button className="bg-amber-500 hover:bg-amber-600" onClick={reload}>
            Try Again
          </Button>
          <Button asChild variant="outline">
            <Link href={homeHref}>Go Back Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (modes.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4">
        <div className="text-5xl mb-4">😢</div>
        <h1 className="text-2xl font-bold text-amber-900 text-center">No story adventures available right now</h1>
        <p className="text-amber-700 text-center">Please ask a grown-up to check the settings.</p>
        <Button asChild className="mt-4">
          <Link href={homeHref}>Go Back Home</Link>
        </Button>
      </div>
    );
  }

  if (error && chosen) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center border-2 border-amber-200">
          <CardHeader>
            <div className="text-5xl mb-2" role="img" aria-label="sleepy wizard">
              {error.outOfStories ? '📚' : '🧙💤'}
            </div>
            <CardTitle className="text-amber-900">{error.outOfStories ? 'No stories left for now' : 'The wizard needs a moment!'}</CardTitle>
            <CardDescription className="text-amber-700">{error.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!error.outOfStories && (
              <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={pending} onClick={() => start(chosen)}>
                Try Again
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setError(null);
                setChosen(null);
              }}
            >
              Pick another way
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pending && chosen) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-6">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-200 to-orange-300 flex items-center justify-center animate-pulse">
          <ModeIcon iconName={chosen.icon} className="h-12 w-12 text-amber-700" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-xl text-amber-800 font-medium">{chosen.loadingMessage || 'Starting your adventure...'}</p>
          <p className="text-amber-600">Get ready for something amazing!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* First-use tip (auto-shows once per account; no-op once seen). */}
      <OnboardingTipTrigger tipId="storyCreation" wizardId="tip-first-story" />
      <header className="px-4 py-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="text-amber-700">
          <Link href={homeHref} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 flex items-center justify-center">
          <Avatar className="h-8 w-8 border-2 border-amber-300">
            {child?.avatarUrl ? <AvatarImage src={child.avatarUrl} alt={child.displayName ?? ''} /> : null}
            <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
              {child?.displayName?.charAt(0).toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="w-10" />
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="text-5xl mb-4">✨</div>
            <h1 className="text-2xl font-bold text-amber-900 leading-tight">How do you want to create your story?</h1>
            <p className="text-amber-700">Pick your favorite way to begin!</p>
            <div className="flex justify-center pt-1">
              <StoriesLeftBadge childId={childId} />
            </div>
          </div>
          <div className="space-y-4">
            {modes.map((mode) => (
              <ModeCard key={mode.modeId} mode={mode} disabled={pending} onClick={() => start(mode)} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
