import { getBookServiceDeps, retryPage } from '@/server/books';
import { BadRequestError, withRoute } from '@/server/http';

/**
 * POST /api/books/{bookId}/pages/{pageNumber}/retry — draw a page whose picture
 * failed again (a new job, so a new idempotency key per retry). 409 when the
 * page has not failed or the Book is locked.
 */
export const POST = withRoute<'user', undefined, { bookId: string; pageNumber: string }>(
  { auth: 'user', name: 'books.pages.retry' },
  async ({ user, params }) => {
    const pageNumber = Number(params.pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new BadRequestError('pageNumber must be a positive integer', { code: 'INVALID_PAGE' });
    }
    return retryPage(await getBookServiceDeps(), user, params.bookId, pageNumber);
  }
);
