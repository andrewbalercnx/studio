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

/** The picture state of one page, from the fields the server's job runner writes. */
export function pageArtState(page: Pick<BookPageDoc, 'artUrl' | 'artJob'>): 'done' | 'failed' | 'pending' {
  if (page.artUrl) return 'done';
  if (page.artJob?.status === 'failed' || page.artJob?.status === 'cancelled') return 'failed';
  return 'pending';
}
