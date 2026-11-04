/**
 * Client-side views of the Book pipeline documents (slice 5.2).
 *
 * The browser reads `books`, `books/{id}/pages`, `manuscripts` and
 * `manuscripts/{id}/pages` directly (owner read-only rules, ADR-0005) and
 * changes them only through `/api/books/**`. The server schemas live in
 * `src/server/data/schemas/{book,manuscript}.ts`, which import firebase-admin
 * and so cannot be bundled for the browser; these types mirror the fields the
 * UI reads.
 */
import type { Timestamp } from 'firebase/firestore';

export type BookStatus = 'draft' | 'illustrating' | 'ready' | 'partial' | 'failed' | 'locked';
export type ManuscriptStatus = 'draft' | 'paginating' | 'ready' | 'failed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type BookDoc = {
  id: string;
  ownerUid: string;
  manuscriptId: string;
  storyId: string;
  childId: string;
  styleId: string;
  layoutId: string | null;
  status: BookStatus;
  art?: { total: number; done: number; failed: number };
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type BookPageDoc = {
  id: string;
  ownerUid: string;
  pageNumber: number;
  kind: 'cover' | 'title' | 'story' | 'dedication' | 'end' | 'blank' | 'back';
  manuscriptPage: number | null;
  artUrl: string | null;
  artJob: { jobId: string; status: JobStatus } | null;
};

/** `books/{id}/castSheets/{castId}`: one cast member's reference sheet (ADR-0006). */
export type BookCastSheetDoc = {
  id: string;
  ownerUid: string;
  castId: string;
  imageUrl: string | null;
  job: { jobId: string; status: JobStatus } | null;
};

/** The page kinds that carry a generated illustration (mirrors server ART_PAGE_KINDS). */
export const ART_PAGE_KINDS: ReadonlySet<BookPageDoc['kind']> = new Set(['cover', 'story']);

export type ManuscriptDoc = {
  id: string;
  ownerUid: string;
  storyId: string;
  childId: string;
  form: string;
  length: number;
  density: string;
  status: ManuscriptStatus;
  title: string | null;
};

export type ManuscriptPageDoc = {
  id: string;
  ownerUid: string;
  pageNumber: number;
  text: string;
  narrationUrl: string | null;
};

/**
 * A Book can be opened in the reader once the server says its pictures are
 * finished (`ready`), finished with gaps (`partial`) or frozen (`locked`).
 * This only names the server's status; it derives nothing from pages.
 */
export function isReadableStatus(status: BookStatus | undefined): boolean {
  return status === 'ready' || status === 'partial' || status === 'locked';
}

// --- Read API DTOs (GET /api/books, GET /api/books/{bookId}) -----------------
// Server-computed shapes so a thin client (mobile) renders without its own
// Firestore access or derivation. `createdAt`/`updatedAt` are ISO strings.

/** One Book in the family's library list (GET /api/books). */
export type BookListItem = {
  id: string;
  storyId: string;
  childId: string;
  styleId: string;
  status: BookStatus;
  title: string | null;
  art: { total: number; done: number; failed: number };
  /** Server-derived: the Book can be opened in the reader. */
  isReady: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

/** One page in a Book read view, words and picture joined. */
export type BookReadPage = {
  pageNumber: number;
  kind: BookPageDoc['kind'];
  artUrl: string | null;
  /** The words a child reads (display names already resolved); null for pages with no text. */
  text: string | null;
  narrationUrl: string | null;
};

/** The making-of stage of a Book and how far through it is (server-computed for GET /api/books/{id}). */
export type BookReadProgress = {
  stage: 'writing' | 'characters' | 'pages';
  done: number | null;
  total: number | null;
  percent: number;
};

/** One Book in full (GET /api/books/{bookId}): meta, pages, and live progress. */
export type BookReadView = {
  id: string;
  storyId: string;
  childId: string;
  styleId: string;
  layoutId: string | null;
  status: BookStatus;
  title: string | null;
  art: { total: number; done: number; failed: number };
  isReady: boolean;
  pages: BookReadPage[];
  /** The making-of stage and how far through, for the progress view. */
  progress: BookReadProgress;
  createdAt: string | null;
  updatedAt: string | null;
};

/** The picture state of one page, from the fields the server's job runner writes. */
export function pageArtState(page: Pick<BookPageDoc, 'artUrl' | 'artJob'>): 'done' | 'failed' | 'pending' {
  if (page.artUrl) return 'done';
  if (page.artJob?.status === 'failed' || page.artJob?.status === 'cancelled') return 'failed';
  return 'pending';
}

export type BookProgressStage = 'writing' | 'characters' | 'pages';

export type BookProgress = {
  stage: BookProgressStage;
  /** Items done and total for the current stage (characters or pages); null while writing. */
  done: number | null;
  total: number | null;
  /** 0–100 across all stages, so the bar only ever moves forward. */
  percent: number;
};

/**
 * Which stage of making a Book to show, and how far through it is — derived
 * live from the documents the browser already watches, not from `book.art`
 * (which the server only writes once, at the end of the illustrate run).
 *
 * The stages follow the pipeline: pagination (writing) → cast sheets (drawing
 * the characters) → page art (drawing the pages). The cast-sheet phase is why
 * a Book used to sit on "0 of 25" for the first ~80 s: the pages existed with
 * no art yet while the characters were being drawn.
 */
export function bookProgress(input: {
  manuscriptStatus: ManuscriptStatus | undefined;
  pages: Array<Pick<BookPageDoc, 'kind' | 'artUrl' | 'artJob'>>;
  castSheets: Array<Pick<BookCastSheetDoc, 'imageUrl'>>;
}): BookProgress {
  const writing = !input.manuscriptStatus || input.manuscriptStatus === 'paginating' || input.manuscriptStatus === 'draft';
  if (writing) return { stage: 'writing', done: null, total: null, percent: 8 };

  const artPages = input.pages.filter((p) => ART_PAGE_KINDS.has(p.kind));
  const artDone = artPages.filter((p) => !!p.artUrl).length;

  const sheetsTotal = input.castSheets.length;
  const sheetsReady = input.castSheets.filter((s) => !!s.imageUrl).length;

  // Characters stage: sheets are being drawn and no page picture is done yet.
  // Once every sheet is ready (or there were none), move on to the pages.
  if (sheetsTotal > 0 && sheetsReady < sheetsTotal && artDone === 0) {
    return { stage: 'characters', done: sheetsReady, total: sheetsTotal, percent: 10 + Math.round((15 * sheetsReady) / sheetsTotal) };
  }

  const total = artPages.length;
  const fraction = total > 0 ? artDone / total : 0;
  return { stage: 'pages', done: artDone, total, percent: 25 + Math.round(75 * fraction) };
}
