import { createDispatcherFromEnv } from './dispatcher';
import { JobRegistry } from './registry';
import { JobRunner } from './runner';

export * from './dispatcher';
export * from './registry';
export * from './runner';

/**
 * The production registry. Phase 5 slices register their job kinds here
 * (e.g. in `src/server/jobs/kinds.ts`, imported by this module). It is empty
 * until the first slice lands.
 */
export const jobRegistry = new JobRegistry();

let defaultRunner: JobRunner | null = null;

/** The process-wide runner: Admin SDK Firestore, `jobRegistry`, dispatcher from env. */
export function getJobRunner(): JobRunner {
  defaultRunner ??= new JobRunner({ registry: jobRegistry, dispatcher: createDispatcherFromEnv() });
  return defaultRunner;
}
