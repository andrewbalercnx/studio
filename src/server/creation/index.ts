/**
 * Creation (slice 5.3): Stories made by a child and the AI in one of five
 * modes, behind one interface and three routes.
 * See docs/architecture/target/slices/5.3-creation-server.md.
 */
import { getDb } from '../data/db';
import { getJobRunner } from '../jobs';
import { defaultEngineDeps } from './deps';
import type { CreationServiceDeps } from './service';

export * from './service';
export * from './views';
export { STORY_FINISH_KIND, registerCreationJobs, finishSpec } from './finish';
export { MODE_SOURCE_IDS, listCreationModes, loadCreationMode, type CreationMode } from './modes';
export type { ChildInput, CreationModeEngine, Done, Turn } from './engine';

/** Production service dependencies: Admin SDK Firestore, the process-wide job runner, the AI harness. */
export async function getCreationServiceDeps(): Promise<CreationServiceDeps> {
  const db = await getDb();
  return { db, runner: getJobRunner(), engines: await defaultEngineDeps(db) };
}

/** Firestore for the read routes (no engines or job runner needed). */
export async function getCreationReadDb() {
  return getDb();
}
