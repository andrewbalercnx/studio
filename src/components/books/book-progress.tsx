'use client';

/**
 * Progress of a Book while the server makes it. Everything shown comes from
 * the Book and Manuscript documents the job runner writes (status, art rollup);
 * the page only watches, so closing it changes nothing.
 */
import { LoaderCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { bookProgress, type BookCastSheetDoc, type BookPageDoc, type ManuscriptDoc } from '@/lib/books/types';

const STAGE_COPY = {
  writing: { emoji: '✏️', label: 'Writing the pages…', aria: 'pencil' },
  characters: { emoji: '🧑‍🎨', label: 'Drawing the characters…', aria: 'artist' },
  pages: { emoji: '🎨', label: 'Drawing the pictures…', aria: 'paint brush' },
} as const;

export function BookProgress({
  manuscript,
  pages,
  castSheets,
}: {
  manuscript: ManuscriptDoc | null;
  pages: BookPageDoc[];
  castSheets: BookCastSheetDoc[];
}) {
  const progress = bookProgress({ manuscriptStatus: manuscript?.status, pages, castSheets });
  const copy = STAGE_COPY[progress.stage];
  const count =
    progress.stage === 'characters' && progress.total
      ? `${progress.done} of ${progress.total} characters ready`
      : progress.stage === 'pages' && progress.total
        ? `page ${Math.min(progress.done! + 1, progress.total)} of ${progress.total}`
        : null;

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center" data-testid="book-progress">
      <div className="text-6xl animate-bounce" role="img" aria-label={copy.aria}>
        {copy.emoji}
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-amber-900">{copy.label}</h1>
        {count && <p className="text-amber-700" data-testid="book-progress-count">{count}</p>}
      </div>
      <div className="w-full max-w-sm space-y-2">
        <Progress value={progress.percent} className="h-3" />
        <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Your book keeps getting made even if you close this page.
        </p>
      </div>
    </div>
  );
}

export function BookFailed({ manuscriptFailed }: { manuscriptFailed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center" data-testid="book-failed">
      <span className="text-6xl" role="img" aria-label="sad book">📕</span>
      <h1 className="text-2xl font-bold text-amber-900">This book got a bit stuck</h1>
      <p className="text-amber-700 max-w-sm">
        {manuscriptFailed
          ? "We couldn't write the pages for this book. Ask a grown-up to try making it again."
          : "We couldn't draw the pictures for this book. Ask a grown-up to help."}
      </p>
    </div>
  );
}
