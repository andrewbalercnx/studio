import { getBook, getBookReadDb } from '@/server/books';
import { withRoute } from '@/server/http';

/**
 * GET /api/books/{bookId} — one of the caller's Books in full: meta and title,
 * every page with its words and picture joined, and the live making-of
 * progress (stage + percent). Owner and persona scope are checked. Mobile
 * lists Books through GET /api/books and reads one here (no direct Firestore).
 * Response: `{ ok: true, data: BookReadView }`.
 */
export const GET = withRoute<'user', undefined, { bookId: string }>(
  { auth: 'user', name: 'books.get' },
  async ({ user, params }) => getBook(await getBookReadDb(), user, params.bookId)
);
