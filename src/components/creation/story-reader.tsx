'use client';

/**
 * Read a finished Story (slice 5.4), shared by the kids PWA and the web child
 * shell. The words come from `GET /api/stories/{id}` with names resolved on
 * the server; "Read to Me" uses the browser's voice. The Story's Books (server
 * status) and "make a book" sit underneath.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, LoaderCircle, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useStoryView } from '@/hooks/use-stories';
import { useBooks } from '@/hooks/use-books';
import { isReadableStatus } from '@/lib/books/types';

export type StoryReaderProps = {
  storyId: string;
  /** The child whose story this should be (a story of another child reads as "not found"). */
  childId: string;
  autoReadAloud?: boolean;
  /** Remember the child's read-aloud preference. */
  onAutoReadChange?: (enabled: boolean) => void;
  backHref: string;
  bookHref: (bookId: string) => string;
  createBookHref: string;
  /** Continue a Story that is not finished yet. */
  playHref: string;
};

export function StoryReader({ storyId, childId, autoReadAloud, onAutoReadChange, backHref, bookHref, createBookHref, playHref }: StoryReaderProps) {
  const { story, loading, error, reload } = useStoryView(storyId);
  const { books } = useBooks({ storyId });
  const [isReading, setIsReading] = useState(false);
  const autoStarted = useRef(false);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsReading(false);
  }, []);

  const read = useCallback(() => {
    if (isReading) {
      stop();
      onAutoReadChange?.(false);
      return;
    }
    if (!story?.text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    onAutoReadChange?.(true);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${story.title ?? ''}. ${story.text}`);
    utterance.rate = 0.9;
    utterance.pitch = 1.1;
    utterance.onend = () => setIsReading(false);
    utterance.onerror = () => setIsReading(false);
    setIsReading(true);
    window.speechSynthesis.speak(utterance);
  }, [isReading, story, stop, onAutoReadChange]);

  useEffect(() => {
    if (autoReadAloud && story?.text && !autoStarted.current) {
      autoStarted.current = true;
      const timer = setTimeout(() => read(), 500);
      return () => clearTimeout(timer);
    }
  }, [autoReadAloud, story?.text, read]);

  useEffect(() => stop, [stop]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  if (error || !story || story.childId !== childId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4 text-center">
        <div className="text-5xl">📖</div>
        <h2 className="text-xl font-semibold text-amber-900">{error ? 'Your story is hiding!' : 'Story not found'}</h2>
        <p className="text-amber-700">{error ? "We couldn't fetch your story right now." : "We couldn't find this story."}</p>
        <div className="flex gap-3">
          {!!error && (
            <Button className="bg-amber-500 hover:bg-amber-600" onClick={reload}>
              Try Again
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Stories
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (story.status !== 'complete' || !story.text) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 gap-4 text-center">
        <div className="text-5xl">✏️</div>
        <h2 className="text-xl font-semibold text-amber-900">This story isn&apos;t finished yet</h2>
        <div className="flex gap-3">
          <Button asChild className="bg-amber-500 hover:bg-amber-600">
            <Link href={playHref}>Keep going</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={backHref}>Back to Stories</Link>
          </Button>
        </div>
      </div>
    );
  }

  const title = story.title || 'Your Story';
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-amber-50 to-orange-50">
      <header className="sticky top-0 z-50 px-4 py-3 flex items-center justify-between bg-white/80 backdrop-blur border-b border-amber-200">
        <Button asChild variant="ghost" size="icon" className="text-amber-700">
          <Link href={backHref} aria-label="Back to Stories">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex -space-x-2">
          {story.cast.slice(0, 3).map((member) => (
            <Avatar key={member.castId} className="h-8 w-8 border-2 border-white">
              {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.displayName} /> : null}
              <AvatarFallback className="bg-amber-200 text-amber-800 text-xs">{member.displayName.charAt(0)}</AvatarFallback>
            </Avatar>
          ))}
        </div>
        <Button variant={isReading ? 'default' : 'secondary'} size="sm" onClick={read} className={isReading ? 'bg-amber-500 hover:bg-amber-600' : ''}>
          {isReading ? (
            <>
              <VolumeX className="mr-1 h-4 w-4" />
              Stop
            </>
          ) : (
            <>
              <Volume2 className="mr-1 h-4 w-4" />
              Read to Me
            </>
          )}
        </Button>
      </header>

      <main className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-amber-900 text-center mb-6">{title}</h1>
        <div className="space-y-4" data-testid="story-text">
          {story.text.split(/\n\s*\n/).map((paragraph, index) => (
            <p key={index} className="text-lg text-gray-800 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-amber-200 space-y-3">
          {books.map((book) => (
            <Link
              key={book.id}
              href={bookHref(book.id)}
              className="flex items-center gap-3 p-3 bg-emerald-500 rounded-2xl shadow-md hover:bg-emerald-600 transition-colors"
            >
              <div className="w-14 h-14 rounded-lg bg-white/30 flex items-center justify-center">
                <span className="text-2xl">📚</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-semibold truncate">
                  {isReadableStatus(book.status) ? 'Read Picture Book' : book.status === 'failed' ? 'Book got stuck' : 'Book being made…'}
                </div>
              </div>
              <ChevronRight className="h-6 w-6 text-white/80 flex-shrink-0" />
            </Link>
          ))}
          <Link
            href={createBookHref}
            className="flex items-center justify-center gap-2 p-4 bg-white border-2 border-amber-500 rounded-2xl shadow-md hover:bg-amber-50 transition-colors"
          >
            <Sparkles className="h-5 w-5 text-amber-500" />
            <span className="text-amber-600 font-semibold text-lg">{books.length > 0 ? 'Create Another Book' : 'Create Picture Book'}</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
