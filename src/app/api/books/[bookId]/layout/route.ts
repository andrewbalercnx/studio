import { z } from 'zod';
import { getBookServiceDeps, setBookLayout } from '@/server/books';
import { withRoute } from '@/server/http';

const Body = z.object({ layoutId: z.string().min(1).max(128).nullable() });

/**
 * PUT /api/books/{bookId}/layout — tie a print template to a finished Book
 * (`{ layoutId }`), or go back to the screen format (`{ layoutId: null }`).
 * A change redraws every picture at the template's shape, free of charge; the
 * same template again changes nothing (`redrawn: false`). 409 BOOK_LOCKED,
 * 409 BOOK_NOT_FINISHED, 404 LAYOUT_NOT_FOUND, 400 LAYOUT_NOT_PRINT,
 * 409 LAYOUT_UNSUPPORTED.
 */
export const PUT = withRoute<'user', typeof Body, { bookId: string }>(
  { auth: 'user', body: Body, name: 'books.setLayout' },
  async ({ user, params, body }) => setBookLayout(await getBookServiceDeps(), user, params.bookId, body.layoutId)
);
