'use client';

/**
 * One Book, live: progress while the server makes it, then the reader.
 * Parent controls (retry a failed picture, lock / unlock) are shown only when
 * `parent` is given; each action asks for the parent PIN first through the
 * caller's guard (`useParentGuard` on the web).
 */
import { useState } from 'react';
import Link from 'next/link';
import { Lock, LoaderCircle, Printer, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useBook, useBookCastSheets, useBookPages, useManuscript, useManuscriptPages } from '@/hooks/use-books';
import { isReadableStatus } from '@/lib/books/types';
import { BookFailed, BookProgress } from './book-progress';
import { BookReader } from './book-reader';
import { PrintProof } from './print-proof';
import { PrintPreview } from './print-preview';
import { PrintTemplate } from './print-template';
import type { BookDoc } from '@/lib/books/types';
import { api } from '@/lib/api';

export type BookViewParentControls = {
  /** Returns true when the parent PIN guard is open; otherwise asks for the PIN and returns false. */
  requireGuard: () => boolean;
};

/**
 * Why the Book cannot be ordered yet, from the server's fields (null: it can). The order
 * route checks the same: finished pictures, a template, and its print pictures ready.
 */
function printBlocker(book: BookDoc): string | null {
  const locked = book.status === 'locked';
  if (book.status === 'partial' || (book.art?.failed ?? 0) > 0) return 'Draw the missing pictures again to print this book.';
  if (book.status === 'failed') return 'This book could not be finished, so it cannot be printed.';
  if (book.status !== 'ready' && !locked) return 'You can order a printed copy once the pictures are finished.';
  const print = book.print?.layoutId === book.layoutId ? book.print : null;
  if (!book.layoutId || !print) {
    return locked ? 'Unlock the book to choose a print template.' : 'Choose a print template below to order a printed copy.';
  }
  if (print.status === 'preparing') return `Preparing the pictures for print (${print.done} of ${print.total})…`;
  if (print.status !== 'ready') return locked ? 'Unlock the book to prepare the pictures for print again.' : 'Some pictures could not be prepared for print. Try again below.';
  return null;
}

export function BookView({ bookId, parent, admin = false }: { bookId: string; parent?: BookViewParentControls; admin?: boolean }) {
  const { toast } = useToast();
  const { data: book, loading: bookLoading } = useBook(bookId);
  const { pages } = useBookPages(book ? bookId : null);
  const { castSheets } = useBookCastSheets(book && !isReadableStatus(book.status) ? bookId : null);
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
        await run(() => api.books.retryPage(bookId, pageNumber), 'Drawing that picture again');
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
    body = <BookProgress manuscript={manuscript} pages={pages} castSheets={castSheets} />;
  }

  return (
    <div className="w-full space-y-4">
      {body}
      {parent && (
        <Card className="max-w-2xl mx-auto">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            {locked ? (
              <Button variant="outline" disabled={busy} onClick={() => run(() => api.books.unlock(bookId), 'Book unlocked')}>
                <Unlock className="mr-2 h-4 w-4" />
                Unlock book
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy || !(book.status === 'ready' || book.status === 'partial')}
                onClick={() => run(() => api.books.lock(bookId), 'Book locked')}
              >
                <Lock className="mr-2 h-4 w-4" />
                Lock book
              </Button>
            )}
            {printBlocker(book) === null ? (
              <Button asChild variant="default" data-testid="order-print">
                <Link href={`/books/${encodeURIComponent(bookId)}/order`}>
                  <Printer className="mr-2 h-4 w-4" />
                  Order a printed copy
                </Link>
              </Button>
            ) : (
              <span className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="print-unavailable">
                <Printer className="h-4 w-4" />
                {printBlocker(book)}
              </span>
            )}
            <div className="basis-full border-t pt-3">
              <PrintTemplate
                bookId={bookId}
                layoutId={book.layoutId ?? null}
                status={book.status}
                print={book.print ?? null}
                requireGuard={parent.requireGuard}
              />
            </div>
          </CardContent>
        </Card>
      )}
      {parent && book.print && book.print.layoutId === book.layoutId && <PrintPreview pages={pages} print={book.print} />}
      {admin && isReadableStatus(book.status) && (
        <PrintProof bookId={bookId} canRender={(book.status === 'ready' || locked) && (book.art?.failed ?? 0) === 0} />
      )}
    </div>
  );
}
