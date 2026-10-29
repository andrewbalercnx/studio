'use client';

/**
 * A Book in a list ("My Books", a parent's book list): cover picture, title
 * and the server's status. Readable Books (`ready`, `partial`, `locked`) open
 * the reader; a Book being made shows its progress.
 */
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useBookPage, useManuscript } from '@/hooks/use-books';
import { isReadableStatus, type BookDoc } from '@/lib/books/types';

function statusLine(book: BookDoc): { text: string; tone: string; spinning?: boolean } {
  switch (book.status) {
    case 'ready':
    case 'locked':
      return { text: 'Ready to read', tone: 'text-emerald-600' };
    case 'partial':
      return { text: 'Ready to read (a few pictures missing)', tone: 'text-emerald-600' };
    case 'failed':
      return { text: 'Got stuck', tone: 'text-rose-600' };
    default: {
      const art = book.art;
      const progress = art && art.total > 0 ? ` ${art.done}/${art.total}` : '';
      return { text: `Being made…${progress}`, tone: 'text-amber-600', spinning: true };
    }
  }
}

export function BookCard({ book, href }: { book: BookDoc; href: string }) {
  const { data: manuscript } = useManuscript(book.manuscriptId);
  const { data: cover } = useBookPage(book.id, 1);
  const title = manuscript?.title || 'My Book';
  const status = statusLine(book);

  return (
    <Link href={href} className="block" data-testid="book-card" data-book-status={book.status}>
      <Card className="overflow-hidden hover:shadow-lg transition-shadow">
        <div className="aspect-square relative bg-gray-100">
          {cover?.artUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Storage download URL (or TEST_MODE data URL)
            <img src={cover.artUrl} alt={title} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
              <span className="text-5xl">📚</span>
            </div>
          )}
        </div>
        <CardContent className="p-3">
          <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 mb-1">{title}</h3>
          <div className={`flex items-center gap-1 text-xs ${status.tone}`}>
            {status.spinning ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <span>{isReadableStatus(book.status) ? '📖' : '⚠️'}</span>}
            <span>{status.text}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
