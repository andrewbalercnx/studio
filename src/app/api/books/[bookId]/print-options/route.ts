import { getPrintReadDb, printOptions } from '@/server/print';
import { withRoute } from '@/server/http';

/**
 * GET /api/books/{bookId}/print-options — the print templates this Book can be
 * printed in (its length fits the template's page model and product), each with
 * its interior page count, trim size and retail price. Cheapest first.
 * Response: `{ ok: true, data: PrintOption[] }`.
 */
export const GET = withRoute<'user', undefined, { bookId: string }>(
  { auth: 'user', name: 'books.printOptions' },
  async ({ user, params }) => printOptions(await getPrintReadDb(), user, params.bookId)
);
