/**
 * Children, Characters and their Likeness (slice 5.7).
 * See docs/architecture/target/slices/5.7-characters.md.
 */
import { getDb } from '../data/db';
import { getJobRunner } from '../jobs';
import type { PeopleDeps } from './service';

export * from './service';
export { avatarSpec, likenessSpecs, LIKENESS_JOB_KINDS, registerLikenessJobs } from './likeness-jobs';

export async function getPeopleDeps(): Promise<PeopleDeps> {
  const { firebaseBlobStore } = await import('../books/media');
  return { db: await getDb(), runner: getJobRunner(), blobs: firebaseBlobStore, now: () => new Date() };
}
