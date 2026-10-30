import { createDispatcherFromEnv } from './dispatcher';
import { registerJobKinds } from './kinds';
import { JobRegistry } from './registry';
import { JobRunner } from './runner';

export * from './dispatcher';
export * from './registry';
export * from './runner';

/** The production registry, with every slice's job kinds (`./kinds.ts`). */
export const jobRegistry = registerJobKinds(new JobRegistry());

let defaultRunner: JobRunner | null = null;

/** The process-wide runner: Admin SDK Firestore, `jobRegistry`, dispatcher from env. */
export function getJobRunner(): JobRunner {
  defaultRunner ??= new JobRunner({ registry: jobRegistry, dispatcher: createDispatcherFromEnv() });
  return defaultRunner;
}
