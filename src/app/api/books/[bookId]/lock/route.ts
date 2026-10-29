import { getBookServiceDeps, lockBook } from '@/server/books';
import { withRoute } from '@/server/http';

/**
 * POST /api/books/{bookId}/lock — freeze a finished Book (`ready` or `partial`)
 * so it can be printed and shared. Idempotent.
 */
export const POST = withRoute<'user', undefined, { bookId: string }>(
  { auth: 'user', name: 'books.lock' },
  async ({ user, params }) => lockBook(await getBookServiceDeps(), user, params.bookId)
);
