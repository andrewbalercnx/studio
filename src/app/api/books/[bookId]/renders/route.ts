import { z } from 'zod';
import { getPrintReadDb, getPrintServiceDeps, listRenders, startRender } from '@/server/print';
import { ok, withRoute } from '@/server/http';

const Body = z.object({
  layoutId: z.string().min(1),
  // A double tap must not start two renders.
  idempotencyKey: z.string().min(8).max(128),
});

/**
 * POST /api/books/{bookId}/renders — start a print render of this Book in a
 * template. Locks a `ready` Book (content frozen, ADR-0010); refuses a Book
 * with missing pictures (409 BOOK_HAS_MISSING_ART) or one still being made
 * (409 BOOK_NOT_FINISHED). Renders are immutable; the same idempotency key
 * returns the same render. Response: `{ ok: true, data: { renderId, jobId, status } }`.
 */
export const POST = withRoute<'user', typeof Body, { bookId: string }>(
  { auth: 'user', body: Body, name: 'books.renders.create' },
  async ({ user, body, params }) => {
    const result = await startRender(await getPrintServiceDeps(), user, params.bookId, body);
    return ok(result, result.status === 'rendering' ? 202 : 200);
  }
);

/** GET /api/books/{bookId}/renders — the Book's finished renders, newest first. */
export const GET = withRoute<'user', undefined, { bookId: string }>(
  { auth: 'user', name: 'books.renders.list' },
  async ({ user, params }) => listRenders(await getPrintReadDb(), user, params.bookId)
);
