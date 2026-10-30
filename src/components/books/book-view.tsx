'use client';

/**
 * One Book, live: progress while the server makes it, then the reader.
 * Parent controls (retry a failed picture, lock / unlock) are shown only when
 * `parent` is given; each action asks for the parent PIN first through the
 * caller's guard (`useParentGuard` on the web).
 */
import { useState } from 'react';
import { Lock, LoaderCircle, Printer, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useBook, useBookPages, useManuscript, useManuscriptPages } from '@/hooks/use-books';
import { lockBook, retryBookPage, unlockBook } from '@/lib/books/api';
import { isReadableStatus } from '@/lib/books/types';
import { BookFailed, BookProgress } from './book-progress';
import { BookReader } from './book-reader';

export type BookViewParentControls = {
  /** Returns true when the parent PIN guard is open; otherwise asks for the PIN and returns false. */
  requireGuard: () => boolean;
};

export function BookView({ bookId, parent }: { bookId: string; parent?: BookViewParentControls }) {
  const { toast } = useToast();
  const { data: book, loading: bookLoading } = useBook(bookId);
  const { pages } = useBookPages(book ? bookId : null);
  const { data: manuscript } = useManuscript(book?.manuscriptId);
  const { pages: words } = useManuscriptPages(manuscript?.status === 'ready' ? manuscript.id : null);
  const [busy, setBusy] = useState(false);

  if (bookLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoaderCircle className="h-12 w-12 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <span className="text-5xl" role="img" aria-label="books">📚</span>
        <p className="text-amber-800">We couldn&apos;t find this book.</p>
      </div>
    );
  }

  const title = manuscript?.title || 'My Book';
  const locked = book.status === 'locked';

  const run = async (action: () => Promise<unknown>, done: string) => {
    if (!parent || !parent.requireGuard()) return;
    setBusy(true);
    try {
      await action();
      toast({ title: done });
    } catch (err) {
      toast({
        title: 'That did not work',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const retryPage = parent
    ? async (pageNumber: number) => {
        await run(() => retryBookPage(bookId, pageNumber), 'Drawing that picture again');
      }
    : undefined;

  let body: React.ReactNode;
  if (book.status === 'failed' && manuscript?.status === 'failed') {
    body = <BookFailed manuscriptFailed />;
  } else if (book.status === 'failed' && !parent) {
    body = <BookFailed manuscriptFailed={false} />;
  } else if (isReadableStatus(book.status) || (book.status === 'failed' && parent)) {
    body = <BookReader title={title} pages={pages} words={words} onRetryPage={retryPage} locked={locked} />;
  } else {
    body = <BookProgress book={book} manuscript={manuscript} />;
  }

  return (
    <div className="w-full space-y-4">
      {body}
      {parent && (
        <Card className="max-w-2xl mx-auto">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            {locked ? (
              <Button variant="outline" disabled={busy} onClick={() => run(() => unlockBook(bookId), 'Book unlocked')}>
                <Unlock className="mr-2 h-4 w-4" />
                Unlock book
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy || !(book.status === 'ready' || book.status === 'partial')}
                onClick={() => run(() => lockBook(bookId), 'Book locked')}
              >
                <Lock className="mr-2 h-4 w-4" />
                Lock book
              </Button>
            )}
            <span className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="print-coming-soon">
              <Printer className="h-4 w-4" />
              Printing is coming soon for new books.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
