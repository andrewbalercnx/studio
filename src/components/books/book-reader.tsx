'use client';

/**
 * Reader for a Book from the server pipeline: the cover, then one story page
 * at a time with its picture (`books/{id}/pages`), its words and narration
 * (`manuscripts/{id}/pages`). A partial Book is readable; a page whose picture
 * failed shows a placeholder and, for a parent, a retry button.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, LoaderCircle, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pageArtState, type BookPageDoc, type ManuscriptPageDoc } from '@/lib/books/types';

export type BookReaderProps = {
  title: string;
  pages: BookPageDoc[];
  words: ManuscriptPageDoc[];
  /** Parent only: draw a failed page again. Omitted for children. */
  onRetryPage?: (pageNumber: number) => Promise<void>;
  /** True while the Book is locked (no retries). */
  locked?: boolean;
};

export function BookReader({ title, pages, words, onRetryPage, locked }: BookReaderProps) {
  const [index, setIndex] = useState(0);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const wordsByPage = useMemo(() => new Map(words.map((w) => [w.pageNumber, w])), [words]);
  const shown = useMemo(() => pages.filter((p) => p.kind === 'cover' || p.kind === 'story'), [pages]);
  const page = shown[Math.min(index, Math.max(shown.length - 1, 0))];
  const pageWords = page?.manuscriptPage ? wordsByPage.get(page.manuscriptPage) : undefined;

  // Stop narration when the page changes or the reader closes.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(false);
    };
  }, [index]);

  if (!page) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoaderCircle className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  const art = pageArtState(page);
  const isCover = page.kind === 'cover';

  const toggleNarration = () => {
    if (!pageWords?.narrationUrl) return;
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const audio = new Audio(pageWords.narrationUrl);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audioRef.current = audio;
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const retry = async () => {
    if (!onRetryPage) return;
    setRetrying(page.pageNumber);
    try {
      await onRetryPage(page.pageNumber);
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto px-4 pb-8" data-testid="book-reader">
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-amber-50 border-4 border-amber-200 shadow-lg">
        {art === 'done' ? (
          // eslint-disable-next-line @next/next/no-img-element -- art URLs are Storage download URLs (or TEST_MODE data URLs)
          <img src={page.artUrl!} alt={isCover ? title : `Picture for page ${page.manuscriptPage}`} className="h-full w-full object-cover" />
        ) : art === 'failed' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <ImageOff className="h-12 w-12 text-amber-400" />
            <p className="text-amber-800">This picture didn&apos;t come out.</p>
            {onRetryPage && !locked && (
              <Button onClick={retry} disabled={retrying !== null} variant="outline">
                {retrying === page.pageNumber ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Draw this picture again
              </Button>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-amber-700">
            <LoaderCircle className="h-10 w-10 animate-spin" />
            <p>Drawing this picture…</p>
          </div>
        )}
        {isCover && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-white text-center drop-shadow">{title}</h1>
          </div>
        )}
      </div>

      {!isCover && (
        <div className="w-full flex items-start gap-3">
          <p className="flex-1 text-lg sm:text-xl leading-relaxed text-gray-900" data-testid="book-page-text">
            {pageWords?.text ?? ''}
          </p>
          {pageWords?.narrationUrl && (
            <Button
              variant="outline"
              size="icon"
              onClick={toggleNarration}
              aria-label={playing ? 'Stop reading aloud' : 'Read this page aloud'}
            >
              {playing ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </Button>
          )}
        </div>
      )}

      <div className="flex w-full items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm text-amber-800">
          {isCover ? 'Cover' : `Page ${page.manuscriptPage} of ${shown.length - 1}`}
        </span>
        <Button
          variant="outline"
          onClick={() => setIndex((i) => Math.min(shown.length - 1, i + 1))}
          disabled={index >= shown.length - 1}
          aria-label="Next page"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
