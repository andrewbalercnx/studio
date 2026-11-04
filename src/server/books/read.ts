/**
 * Read views of the Book pipeline for thin clients (mobile especially, which
 * has no direct Firestore access): the family's library list and one Book in
 * full. Server-first — filtering, sorting and the progress/`isReady`
 * derivations happen here, so every client renders the same thing (ADR-0005,
 * CLAUDE.md server-first principle).
 */
import type { Firestore } from 'firebase-admin/firestore';
import { isReadableStatus, type BookListItem, type BookReadPage, type BookReadProgress, type BookReadView } from '@/lib/books/types';
import type { BookPage, CastSheet } from '../data/schemas/book';
import type { ManuscriptStatus } from '@/lib/books/types';
import { assertOwner, type VerifiedUser } from '../http';
import { books, bookPages, castSheets, manuscriptPages, manuscripts } from '../data/repositories';

export type { BookListItem, BookReadView };

const ART_PAGE_KINDS: ReadonlySet<BookPage['kind']> = new Set(['cover', 'story']);

/**
 * The making-of stage and how far through, from the live documents (not
 * `book.art`, which the server writes only at the end of the illustrate run):
 * pagination (writing) → cast sheets (characters) → page art (pages). The
 * cast-sheet phase is why a Book used to look stuck at "0 of 25".
 */
function computeProgress(input: {
  manuscriptStatus: ManuscriptStatus | undefined;
  pages: Array<Pick<BookPage, 'kind' | 'artUrl'>>;
  castSheets: Array<Pick<CastSheet, 'imageUrl'>>;
}): BookReadProgress {
  const writing = !input.manuscriptStatus || input.manuscriptStatus === 'paginating' || input.manuscriptStatus === 'draft';
  if (writing) return { stage: 'writing', done: null, total: null, percent: 8 };

  const artPages = input.pages.filter((p) => ART_PAGE_KINDS.has(p.kind));
  const artDone = artPages.filter((p) => !!p.artUrl).length;
  const sheetsTotal = input.castSheets.length;
  const sheetsReady = input.castSheets.filter((s) => !!s.imageUrl).length;

  if (sheetsTotal > 0 && sheetsReady < sheetsTotal && artDone === 0) {
    return { stage: 'characters', done: sheetsReady, total: sheetsTotal, percent: 10 + Math.round((15 * sheetsReady) / sheetsTotal) };
  }
  const total = artPages.length;
  return { stage: 'pages', done: artDone, total, percent: 25 + Math.round(75 * (total > 0 ? artDone / total : 0)) };
}

function iso(value: unknown): string | null {
  return value && typeof (value as { toMillis?: unknown }).toMillis === 'function'
    ? new Date((value as { toMillis(): number }).toMillis()).toISOString()
    : null;
}

function artOf(book: { art?: { total: number; done: number; failed: number } }): { total: number; done: number; failed: number } {
  return book.art ?? { total: 0, done: 0, failed: 0 };
}

/**
 * The family's Books, newest first. Optionally one child's or one story's.
 * The caller is the owner (admin/writer see every family's — same rule as the
 * ownership guard). Titles come from each Book's Manuscript.
 */
export async function listBooks(
  db: Firestore,
  user: VerifiedUser,
  filter: { childId?: string | null; storyId?: string | null } = {}
): Promise<BookListItem[]> {
  const where: Record<string, unknown> = { ownerUid: user.uid };
  if (filter.childId) where.childId = filter.childId;
  if (filter.storyId) where.storyId = filter.storyId;
  const found = await books.using(db).where(where);

  const titles = new Map<string, string | null>(
    await Promise.all(
      [...new Set(found.map((b) => b.manuscriptId))].map(
        async (id): Promise<[string, string | null]> => [id, (await manuscripts.using(db).get(id))?.title ?? null]
      )
    )
  );

  return found
    .map((book) => ({
      id: book.id,
      storyId: book.storyId,
      childId: book.childId,
      styleId: book.styleId,
      status: book.status,
      title: titles.get(book.manuscriptId) ?? null,
      art: artOf(book),
      isReady: isReadableStatus(book.status),
      createdAt: iso(book.createdAt),
      updatedAt: iso(book.updatedAt),
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * One Book in full: its meta and title, every page with its words and picture
 * joined, and the live making-of progress. Owner and persona scope are
 * enforced. Missing Book → 404.
 */
export async function getBook(db: Firestore, user: VerifiedUser, bookId: string): Promise<BookReadView> {
  const book = await books.using(db).require(bookId);
  await assertOwner(user, book, 'Book');

  const manuscript = await manuscripts.using(db).get(book.manuscriptId);
  const [pages, msPages, sheets] = await Promise.all([
    bookPages.using(db).of(bookId).where({}),
    manuscriptPages.using(db).of(book.manuscriptId).where({}),
    castSheets.using(db).of(bookId).where({}),
  ]);

  const textByPage = new Map<number, { text: string; narrationUrl: string | null }>(
    msPages.map((p) => [p.pageNumber, { text: p.text, narrationUrl: p.narrationUrl }])
  );

  const readPages: BookReadPage[] = pages
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => {
      const words = page.manuscriptPage !== null ? textByPage.get(page.manuscriptPage) : undefined;
      return {
        pageNumber: page.pageNumber,
        kind: page.kind,
        artUrl: page.artUrl,
        text: words?.text ?? null,
        narrationUrl: words?.narrationUrl ?? null,
      };
    });

  const progress = computeProgress({
    manuscriptStatus: manuscript?.status as ManuscriptStatus | undefined,
    pages,
    castSheets: sheets,
  });

  return {
    id: book.id,
    storyId: book.storyId,
    childId: book.childId,
    styleId: book.styleId,
    layoutId: book.layoutId ?? null,
    status: book.status,
    title: manuscript?.title ?? null,
    art: artOf(book),
    isReady: isReadableStatus(book.status),
    pages: readPages,
    progress,
    createdAt: iso(book.createdAt),
    updatedAt: iso(book.updatedAt),
  };
}
