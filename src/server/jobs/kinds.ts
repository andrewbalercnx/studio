/**
 * Every job kind the app runs, registered on the production registry.
 * Handlers resolve their dependencies when a job runs (not at import).
 */
import { defaultBookJobDeps } from '../books/deps';
import { registerBookJobs } from '../books/jobs';
import type { JobRegistry } from './registry';

export function registerJobKinds(registry: JobRegistry): JobRegistry {
  return registerBookJobs(registry, defaultBookJobDeps);
}
