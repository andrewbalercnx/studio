import { NextResponse } from 'next/server';
import { isInternalSecretValid } from '@/lib/internal-secret';
import { getBookServiceDeps, reillustrateBook } from '@/server/books';
import { AppError } from '@/server/errors';

/**
 * Internal, secret-protected book re-illustration.
 *
 * Clears a Book's page art and cast sheets and runs the illustration pipeline
 * again, keeping the words, so the pictures are redrawn from the current
 * likeness and at the current aspect ratio. Acts as the system — ownership is
 * read from the Book document — so it needs no user auth and is not an
 * impersonation path. A locked Book is refused (unlock it first).
 *
 * POST /api/internal/books/reillustrate
 * Header: X-Internal-Secret: <secret>
 * Body:   { "bookId": "bk_…" }
 */
export async function POST(request: Request) {
  const secret = request.headers.get('X-Internal-Secret');
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    console.error('[internal/books/reillustrate] INTERNAL_API_SECRET not configured');
    return NextResponse.json({ ok: false, errorMessage: 'Internal API not configured' }, { status: 500 });
  }
  if (!isInternalSecretValid(secret, expected)) {
    return NextResponse.json({ ok: false, errorMessage: 'Invalid or missing internal secret' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const bookId = typeof body?.bookId === 'string' ? body.bookId.trim() : '';
  if (!bookId) {
    return NextResponse.json({ ok: false, errorMessage: 'Provide bookId' }, { status: 400 });
  }

  try {
    const result = await reillustrateBook(await getBookServiceDeps(), bookId);
    console.log(
      `[internal/books/reillustrate] bookId=${result.bookId} pagesCleared=${result.pagesCleared} castSheetsCleared=${result.castSheetsCleared}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return NextResponse.json({ ok: false, errorMessage: error.message, code: error.code }, { status: error.status });
    }
    console.error('[internal/books/reillustrate] POST Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
