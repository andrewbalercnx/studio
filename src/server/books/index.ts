/**
 * The Book pipeline (slice 5.1): Story → Manuscript → Book on the server.
 * See docs/architecture/target/slices/5.1-book-server.md.
 */
import { getDb } from '../data/db';
import { getJobRunner } from '../jobs';
import type { BookServiceDeps } from './service';

export * from './service';
export { BOOK_JOB_KINDS, registerBookJobs } from './jobs';

/** Production service dependencies: the Admin SDK Firestore and the process-wide job runner. */
export async function getBookServiceDeps(): Promise<BookServiceDeps> {
  return { db: await getDb(), runner: getJobRunner() };
}
