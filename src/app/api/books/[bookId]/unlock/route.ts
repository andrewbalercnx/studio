import { getBookServiceDeps, unlockBook } from '@/server/books';
import { withRoute } from '@/server/http';

/**
 * POST /api/books/{bookId}/unlock — allow changes again. This is where share
 * links will be revoked: the share-link slice registers a hook in
 * `bookUnlockHooks` (src/server/books/service.ts), run in the unlock
 * transaction. Idempotent.
 */
export const POST = withRoute<'user', undefined, { bookId: string }>(
  { auth: 'user', name: 'books.unlock' },
  async ({ user, params }) => unlockBook(await getBookServiceDeps(), user, params.bookId)
);
