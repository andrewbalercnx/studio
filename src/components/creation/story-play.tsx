'use client';

/**
 * The play view for every creation mode (slice 5.4), shared by the kids PWA
 * and the web child shell. It renders the latest turn as the server wrote it
 * (prompt with names, options, what input it expects) and sends the child's
 * answer to `POST /api/stories/{id}/turns`. The Story and its turns are read
 * with live, read-only listeners; nothing is written from the browser.
 *
 *   expects choice    option buttons (Free Play and Guided also take typed ideas)
 *   expects text      a text box
 *   expects castPick  pick who comes along (the mode's suggestions preselected)
 *
 * Then `finishing` (title and synopsis on the server) → `complete`, when the
 * caller moves on to "make a book".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, LoaderCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useSendTurn, useStoryDoc, useStoryTurns } from '@/hooks/use-stories';
import { abandonStory, kidSafeMessage, retryFinish, StoryApiError, type ChildInput } from '@/lib/stories/api';
import { currentPrompt, type TurnDoc } from '@/lib/stories/types';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';
import { cn } from '@/lib/utils';

/** Modes whose engine also takes a typed idea where it offers choices. */
const FREE_TEXT_MODES = new Set(['freeplay', 'guided']);
const FINISH_NUDGE_MS = 45_000;
const EMOJIS = ['🌟', '🦄', '🏰', '🎭', '✨', '🐉', '🚀', '🌈'];

export type StoryPlayProps = {
  storyId: string;
  child?: { displayName?: string | null; avatarUrl?: string | null } | null;
  /** Where "back" and "home" lead (the story stays and can be continued from the story list). */
  homeHref: string;
  /** Called once when the Story is `complete`; the caller opens the Form + Style chooser. */
  onComplete: (storyId: string) => void;
};

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-6 text-center">{children}</div>;
}

function Thinking({ title, detail, writing }: { title: string; detail: string; writing?: boolean }) {
  return (
    <Centered>
      {writing ? (
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-200 to-orange-300 flex items-center justify-center animate-pulse">
          <span className="text-5xl" role="img" aria-label="writing">
            📝
          </span>
        </div>
      ) : (
        <LoaderCircle className="h-16 w-16 text-amber-500 animate-spin" />
      )}
      <div className="space-y-2" data-testid="story-thinking">
        <p className="text-xl text-amber-800 font-medium">{title}</p>
        <p className="text-amber-600">{detail}</p>
      </div>
    </Centered>
  );
}

export function StoryPlay({ storyId, child, homeHref, onComplete }: StoryPlayProps) {
  const { data: story, loading: storyLoading, error: storyError } = useStoryDoc(storyId);
  const { turns, loading: turnsLoading } = useStoryTurns(storyId);
  const { send, pending } = useSendTurn(storyId);
  const [error, setError] = useState<{ message: string; retry: (() => void) | null } | null>(null);
  const [lastInput, setLastInput] = useState<{ promptIndex: number; input: ChildInput } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [retryingFinish, setRetryingFinish] = useState(false);
  // The prompt this tab last answered: until the listener shows a newer one, keep waiting
  // (an old prompt's buttons must never answer the next question).
  const [answeredIndex, setAnsweredIndex] = useState(-1);
  const completedRef = useRef(false);

  const latestPrompt = useMemo(() => currentPrompt(turns), [turns]);
  const prompt = latestPrompt && latestPrompt.index > answeredIndex ? latestPrompt : null;
  const status = story?.status;

  useEffect(() => {
    if (status === 'complete' && !completedRef.current) {
      completedRef.current = true;
      // Funnel: narrative complete (ids/enums only — never the story text).
      track(ANALYTICS_EVENTS.storyCompleted, { sessionId: storyId, storyTypeId: story?.modeId, beats: story?.turnCount });
      onComplete(storyId);
    }
  }, [status, storyId, story?.modeId, story?.turnCount, onComplete]);

  // Finishing normally takes seconds. If it is still going after a while, nudge the
  // server: it re-sends the finish job if that job never reached the queue.
  useEffect(() => {
    if (status !== 'finishing') return;
    const timer = setInterval(() => {
      retryFinish(storyId).catch((err) => console.warn('[StoryPlay] Finish nudge failed', err));
    }, FINISH_NUDGE_MS);
    return () => clearInterval(timer);
  }, [status, storyId]);

  const submit = async (promptIndex: number, input: ChildInput) => {
    setError(null);
    setLastInput({ promptIndex, input });
    track(ANALYTICS_EVENTS.kidsAnswerSelected, { sessionId: storyId, stepIndex: promptIndex });
    try {
      const result = await send(promptIndex, input);
      if (result) setAnsweredIndex((current) => Math.max(current, promptIndex));
    } catch (err) {
      console.error('[StoryPlay] Turn failed', err);
      const conflict = err instanceof StoryApiError && (err.code === 'TURN_CONFLICT' || err.code === 'STORY_NOT_CREATING');
      // A conflict means the listeners already show (or will show) the newest turn: no retry of the old answer.
      setError({ message: kidSafeMessage(err), retry: conflict ? null : () => submit(promptIndex, input) });
    }
  };

  if (storyLoading || (turnsLoading && !story)) {
    return (
      <Centered>
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </Centered>
    );
  }

  if (storyError || !story) {
    return (
      <Centered>
        <div className="text-5xl">📖</div>
        <h1 className="text-2xl font-bold text-amber-900">We couldn&apos;t find this story</h1>
        <Button asChild className="bg-amber-500 hover:bg-amber-600">
          <Link href={homeHref}>Go Back Home</Link>
        </Button>
      </Centered>
    );
  }

  if (status === 'finishing') {
    return <Thinking writing title="Adding the finishing touches!" detail="Your story is getting its title. Just a moment…" />;
  }

  if (status === 'complete') {
    return <Thinking title="Your story is ready!" detail="Let's make it into a book…" />;
  }

  if (status === 'failed') {
    return (
      <Centered>
        <div className="text-5xl">🧙💤</div>
        <h1 className="text-2xl font-bold text-amber-900">Your story got a bit stuck</h1>
        <p className="text-amber-700 max-w-sm">Don&apos;t worry — your story is safe. Let&apos;s try finishing it again!</p>
        <div className="flex gap-3">
          <Button
            className="bg-amber-500 hover:bg-amber-600"
            disabled={retryingFinish}
            onClick={async () => {
              setRetryingFinish(true);
              try {
                await retryFinish(storyId);
              } catch (err) {
                console.error('[StoryPlay] Retry finish failed', err);
                setError({ message: kidSafeMessage(err), retry: null });
              } finally {
                setRetryingFinish(false);
              }
            }}
          >
            Try Again
          </Button>
          <Button asChild variant="outline">
            <Link href={homeHref}>Go Home</Link>
          </Button>
        </div>
        {error && <p className="text-sm text-amber-700">{error.message}</p>}
      </Centered>
    );
  }

  if (status === 'abandoned') {
    return (
      <Centered>
        <div className="text-5xl">🌙</div>
        <h1 className="text-2xl font-bold text-amber-900">This story was stopped</h1>
        <Button asChild className="bg-amber-500 hover:bg-amber-600">
          <Link href={homeHref}>Go Back Home</Link>
        </Button>
      </Centered>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center border-2 border-amber-200">
          <CardHeader>
            <div className="text-5xl mb-2" role="img" aria-label="sleepy wizard">
              🧙💤
            </div>
            <CardTitle className="text-amber-900">The storyteller needs a moment!</CardTitle>
            <CardDescription className="text-amber-700">{error.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error.retry && (
              <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={pending} onClick={error.retry}>
                Try Again
              </Button>
            )}
            <Button variant="ghost" className="w-full" onClick={() => setError(null)}>
              {error.retry ? 'Back to the question' : 'Show me the question'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Waiting for the reply: either this tab sent an answer, or the newest turn is the child's.
  if (pending || !prompt) {
    const answered = lastInput?.promptIndex;
    const answeredTurn = turns.find((t) => t.index === answered);
    const last = !!answeredTurn?.progress?.of && answeredTurn.progress.step >= answeredTurn.progress.of;
    return last ? (
      <Thinking writing title="The storyteller is writing your whole story!" detail="All your answers are turning into a real story. This is the big one — it can take a minute!" />
    ) : (
      <Thinking title="The storyteller is thinking..." detail="Dreaming up what happens next — just a few seconds!" />
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 py-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="text-amber-700">
          <Link href={homeHref} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <Avatar className="h-8 w-8 border-2 border-amber-300">
            {child?.avatarUrl ? <AvatarImage src={child.avatarUrl} alt={child.displayName ?? ''} /> : null}
            <AvatarFallback className="bg-gradient-to-br from-amber-200 to-orange-300 text-amber-800 text-sm font-bold">
              {child?.displayName?.charAt(0).toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
          {prompt.progress && (
            <p className="text-sm text-amber-700" data-testid="story-progress">
              {prompt.progress.of ? `Step ${prompt.progress.step} of ${prompt.progress.of}` : `Step ${prompt.progress.step}`}
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="text-amber-700" aria-label="Stop this story" onClick={() => setConfirmStop(true)}>
          <X className="h-5 w-5" />
        </Button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <div className="text-5xl mb-4">{EMOJIS[Math.floor(prompt.index / 2) % EMOJIS.length]}</div>
            <h1 className="text-2xl font-bold text-amber-900 leading-tight whitespace-pre-line" data-testid="story-prompt">
              {prompt.promptDisplay}
            </h1>
          </div>
          <TurnInput
            key={prompt.index}
            turn={prompt}
            heroId={story.childId}
            freeText={FREE_TEXT_MODES.has(story.modeId)}
            disabled={pending}
            onSubmit={(input) => submit(prompt.index, input)}
          />
        </div>
      </main>

      {prompt.progress?.of ? (
        <footer className="px-4 py-4 flex justify-center gap-1.5">
          {[...Array(prompt.progress.of)].map((_, i) => (
            <div key={i} className={cn('h-2 w-8 rounded-full transition-colors', i < prompt.progress!.step ? 'bg-amber-500' : 'bg-amber-200')} />
          ))}
        </footer>
      ) : null}

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop making this story?</AlertDialogTitle>
            <AlertDialogDescription>
              You can also go back and keep it for later — it waits in My Stories.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await abandonStory(storyId);
                } catch (err) {
                  console.error('[StoryPlay] Abandon failed', err);
                }
              }}
            >
              Stop the story
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TurnInput({
  turn,
  heroId,
  freeText,
  disabled,
  onSubmit,
}: {
  turn: TurnDoc;
  heroId: string;
  freeText: boolean;
  disabled: boolean;
  onSubmit: (input: ChildInput) => void;
}) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set([heroId, ...(turn.options ?? []).filter((o) => o.preselected).map((o) => o.id)])
  );
  const options = turn.options ?? [];
  const expects = turn.expects ?? (options.length > 0 ? 'choice' : 'text');

  const textBox = (placeholder: string) => (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSubmit({ kind: 'text', text: text.trim() });
      }}
    >
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        maxLength={500}
        className="bg-white text-lg border-2 border-amber-200 rounded-2xl"
        aria-label="Your idea"
      />
      <Button type="submit" disabled={disabled || !text.trim()} className="w-full bg-amber-500 hover:bg-amber-600">
        <Send className="h-4 w-4 mr-2" />
        Send my idea
      </Button>
    </form>
  );

  if (expects === 'castPick') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {options.map((option) => {
            const isHero = option.id === heroId;
            const on = picked.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                data-testid="story-cast-option"
                aria-pressed={on}
                disabled={disabled || isHero}
                onClick={() =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (next.has(option.id)) next.delete(option.id);
                    else next.add(option.id);
                    return next;
                  })
                }
                className={cn(
                  'flex items-center gap-2 p-4 rounded-2xl border-2 text-left transition-all',
                  on ? 'border-amber-500 bg-amber-50' : 'border-amber-200 bg-white hover:border-amber-400',
                  isHero && 'cursor-default'
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2',
                    on ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-300'
                  )}
                >
                  {on && <Check className="h-4 w-4" />}
                </span>
                <span className="text-gray-800 font-medium">{option.display}</span>
              </button>
            );
          })}
        </div>
        <Button
          className="w-full bg-amber-500 hover:bg-amber-600 text-lg py-6"
          disabled={disabled}
          onClick={() => onSubmit({ kind: 'castPick', castIds: [...picked] })}
        >
          Let&apos;s go!
        </Button>
      </div>
    );
  }

  if (expects === 'text') {
    return textBox('Type your idea here…');
  }

  return (
    <div className="space-y-3">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          data-testid="story-option"
          disabled={disabled}
          onClick={() => onSubmit({ kind: 'choice', optionId: option.id })}
          className="w-full text-left p-5 rounded-2xl bg-white border-2 border-amber-200 hover:border-amber-400 hover:shadow-lg active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-lg text-gray-800 leading-relaxed whitespace-normal">{option.display}</span>
        </button>
      ))}
      {freeText && <div className="pt-3">{textBox('…or type your own idea')}</div>}
    </div>
  );
}
