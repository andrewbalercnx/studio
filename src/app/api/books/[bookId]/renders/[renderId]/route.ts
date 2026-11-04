import { getPrintReadDb, getRender } from '@/server/print';
import { withRoute } from '@/server/http';

/**
 * GET /api/books/{bookId}/renders/{renderId} — one render: `ready` with its
 * PDF links (interior, cover), or `rendering` / `failed` from its job.
 */
export const GET = withRoute<'user', undefined, { bookId: string; renderId: string }>(
  { auth: 'user', name: 'books.renders.get' },
  async ({ user, params }) => getRender(await getPrintReadDb(), user, params.bookId, params.renderId)
);
