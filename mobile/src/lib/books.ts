import type { BookListItem, BookProgressView, BookStatus } from '../contexts/ApiClientContext';

/** Still being made: the Book view keeps checking for progress. */
export function isBookInProgress(status: BookStatus): boolean {
  return status === 'draft' || status === 'illustrating';
}

/** One line a child or parent can read about where a Book is. */
export function bookStatusLabel(book: Pick<BookListItem, 'status' | 'art' | 'isReady'>): string {
  if (book.status === 'failed') return "This book couldn't be finished";
  if (book.status === 'partial') return 'Ready to read (a few pictures are missing)';
  if (book.isReady) return 'Ready to read';
  if (book.art.total > 0) return `Drawing pictures: ${book.art.done} of ${book.art.total}`;
  return 'Writing the pages…';
}

/** What the server is doing now, in words (BookProgressView.stage). */
export function progressLabel(progress: BookProgressView): string {
  if (progress.stage === 'writing') return 'Writing the pages…';
  if (progress.stage === 'characters') return 'Drawing the characters…';
  if (progress.total) return `Drawing page ${Math.min((progress.done ?? 0) + 1, progress.total)} of ${progress.total}…`;
  return 'Drawing the pictures…';
}
