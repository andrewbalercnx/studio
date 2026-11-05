/**
 * Every job kind the app runs, registered on the production registry.
 * Handlers resolve their dependencies when a job runs (not at import).
 */
import { defaultBookJobDeps } from '../books/deps';
import { registerBookJobs } from '../books/jobs';
import { defaultCharacterJobDeps, registerCharacterJobs } from '../characters/avatar';
import { defaultFinishDeps } from '../creation/deps';
import { registerCreationJobs } from '../creation/finish';
import { registerPrintJobs } from '../print/jobs';
import { registerOrderJobs } from '../orders/jobs';
import type { JobRegistry } from './registry';

export function registerJobKinds(registry: JobRegistry): JobRegistry {
  registerBookJobs(registry, defaultBookJobDeps);
  registerCharacterJobs(registry, defaultCharacterJobDeps);
  registerPrintJobs(registry, async () => (await import('../print')).defaultRenderJobDeps());
  registerOrderJobs(registry, async () => (await import('../orders')).defaultSubmitJobDeps());
  return registerCreationJobs(registry, defaultFinishDeps);
}
