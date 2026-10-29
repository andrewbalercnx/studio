/**
 * Production dependencies for the creation slice: the shared AI harness, the
 * config service, Firestore-bound StoryType reads, env TEST_MODE.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { EngineSetDeps } from './engines';
import type { FinishDeps } from './finish';
import { listStoryTypesForAge, loadStoryType } from './story-types';

async function shared() {
  const [{ getAIHarness }, { configService }, { isTestMode }] = await Promise.all([
    import('../ai/harness'),
    import('../config/config-service'),
    import('@/lib/test-mode'),
  ]);
  return { ai: getAIHarness(), config: configService, testMode: () => isTestMode() };
}

export async function defaultEngineDeps(db: Firestore): Promise<EngineSetDeps> {
  const base = await shared();
  return {
    ...base,
    storyTypes: {
      listForAge: (age) => listStoryTypesForAge(db, age),
      load: (id) => loadStoryType(db, id),
    },
  };
}

let finishDeps: FinishDeps | null = null;

export async function defaultFinishDeps(): Promise<FinishDeps> {
  if (finishDeps) return finishDeps;
  const base = await shared();
  finishDeps = { ai: base.ai, testMode: base.testMode, now: () => new Date() };
  return finishDeps;
}
