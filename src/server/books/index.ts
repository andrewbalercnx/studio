/**
 * The Book pipeline (slice 5.1): Story → Manuscript → Book on the server.
 * See docs/architecture/target/slices/5.1-book-server.md.
 */
import { getDb } from '../data/db';
import { getJobRunner } from '../jobs';
import type { BookServiceDeps } from './service';

export * from './service';
export { listBooks, getBook, type BookListItem, type BookReadView } from './read';
export { BOOK_JOB_KINDS, registerBookJobs } from './jobs';

/** Production service dependencies: the Admin SDK Firestore and the process-wide job runner. */
export async function getBookServiceDeps(): Promise<BookServiceDeps> {
  return { db: await getDb(), runner: getJobRunner() };
}

/** Admin-SDK Firestore for the read routes (GET /api/books, GET /api/books/{id}). */
export async function getBookReadDb() {
  return getDb();
}
