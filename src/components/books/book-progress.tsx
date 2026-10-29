'use client';

/**
 * Progress of a Book while the server makes it. Everything shown comes from
 * the Book and Manuscript documents the job runner writes (status, art rollup);
 * the page only watches, so closing it changes nothing.
 */
import { LoaderCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { BookDoc, ManuscriptDoc } from '@/lib/books/types';

export function BookProgress({ book, manuscript }: { book: BookDoc; manuscript: ManuscriptDoc | null }) {
  const art = book.art ?? { total: 0, done: 0, failed: 0 };
  const writing = !manuscript || manuscript.status === 'paginating' || manuscript.status === 'draft';
  const percent = writing ? 10 : art.total > 0 ? Math.round(10 + (90 * (art.done + art.failed)) / art.total) : 10;

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center" data-testid="book-progress">
      <div className="text-6xl animate-bounce" role="img" aria-label="paint brush">
        {writing ? '✏️' : '🎨'}
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-amber-900">
          {writing ? 'Writing the pages…' : 'Drawing the pictures…'}
        </h1>
        {!writing && art.total > 0 && (
          <p className="text-amber-700">
            {art.done} of {art.total} pictures ready
          </p>
        )}
      </div>
      <div className="w-full max-w-sm space-y-2">
        <Progress value={percent} className="h-3" />
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
