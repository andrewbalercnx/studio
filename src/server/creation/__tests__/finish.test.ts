import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { jobs, stories } from '../../data/repositories';
import { finishSpec, STORY_FINISH_KIND, tidySynopsis, tidyTitle } from '../finish';
import { createStory, retryFinish, submitTurn } from '../service';
import { createBench, key, ledgerUsed, seed, user, type Bench } from './helpers';

const p1 = user('p1');
let bench: Bench;

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench({ testMode: true });
  await seed(bench.db);
});

/** A guided story that finishes on its third turn (TEST_MODE engine); finishing then runs with `testMode` as set. */
async function storyAtFinishing(finishInTestMode: boolean): Promise<string> {
  const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'guided', idempotencyKey: key() });
  await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: key() });
  bench.finishTestMode.on = finishInTestMode;
  const done = await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'B' }, idempotencyKey: key() });
  expect(done.status).toBe('finishing');
  return created.storyId;
}

describe('story.finish', () => {
  it('completes the story and charges the story allowance exactly once', async () => {
    const storyId = await storyAtFinishing(true);
    const before = await stories.using(bench.db).require(storyId);
    expect(before).toMatchObject({ status: 'finishing', finishRuns: 1 });
    const job = await jobs.using(bench.db).require(before.finishJobId!);
    expect(job).toMatchObject({ kind: STORY_FINISH_KIND, ownerUid: 'p1', idempotencyKey: `story.finish:${storyId}`, target: { collection: 'stories', id: storyId } });

    await bench.drain();
    expect(await stories.using(bench.db).require(storyId)).toMatchObject({ status: 'complete', allowance: { charged: true } });
    expect(await ledgerUsed(bench.db)).toBe(1);

    // The same job again, and another run: nothing more is charged.
    await bench.runner.enqueue([finishSpec({ id: storyId, ownerUid: 'p1' }, 1), finishSpec({ id: storyId, ownerUid: 'p1' }, 2)]);
    await bench.drain();
    expect(await ledgerUsed(bench.db)).toBe(1);
  });

  it('retries transient failures, then marks the story failed; a retry finishes it', async () => {
    const storyId = await storyAtFinishing(false);
    bench.ai.respond('story.finish.synopsis', new Error('503 UNAVAILABLE'));
    await bench.drain();
    const failed = await stories.using(bench.db).require(storyId);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'TRANSIENT' } });
    expect(await jobs.using(bench.db).require(failed.finishJobId!)).toMatchObject({ status: 'failed', attempt: 3 });
    expect(await ledgerUsed(bench.db)).toBe(0);

    bench.ai.respond('story.finish.synopsis', 'Emma has a guided adventure in a garden.');
    bench.ai.respond('story.finish.title', 'The Garden Gate');
    expect(await retryFinish(bench.services, p1, storyId)).toEqual({ storyId, status: 'finishing' });
    await bench.drain();
    const done = await stories.using(bench.db).require(storyId);
    expect(done).toMatchObject({ status: 'complete', title: 'The Garden Gate', finishRuns: 2, error: null });
    expect(done.finishJobId).not.toBe(failed.finishJobId);
    expect(await ledgerUsed(bench.db)).toBe(1);
    expect(await retryFinish(bench.services, p1, storyId)).toEqual({ storyId, status: 'complete' });
  });

  it('re-dispatches a finish job whose dispatch was lost, without a new job or run', async () => {
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'guided', idempotencyKey: key() });
    await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: key() });
    bench.finishTestMode.on = true;
    // The queue cannot be reached when the story moves to finishing.
    vi.spyOn(bench.dispatcher, 'dispatch').mockRejectedValueOnce(new Error('Cannot find module'));
    await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'B' }, idempotencyKey: key() });
    await bench.drain();
    const stuck = await stories.using(bench.db).require(created.storyId);
    expect(stuck).toMatchObject({ status: 'finishing', finishRuns: 1 });
    expect(await jobs.using(bench.db).require(stuck.finishJobId!)).toMatchObject({ status: 'queued' });

    expect(await retryFinish(bench.services, p1, created.storyId)).toEqual({ storyId: created.storyId, status: 'finishing' });
    await bench.drain();
    const done = await stories.using(bench.db).require(created.storyId);
    expect(done).toMatchObject({ status: 'complete', finishRuns: 1, finishJobId: stuck.finishJobId });
    expect(await ledgerUsed(bench.db)).toBe(1);
  });

  it('a permanent failure fails at once', async () => {
    const storyId = await storyAtFinishing(false);
    bench.ai.respond('story.finish.synopsis', new Error('400 INVALID_ARGUMENT'));
    await bench.drain();
    expect(await stories.using(bench.db).require(storyId)).toMatchObject({ status: 'failed' });
  });

  it('still completes when the allowance ran out meanwhile, recording that it was not charged', async () => {
    const storyId = await storyAtFinishing(true);
    await bench.db.collection('entitlementLedgers').doc('p1').set({ freeTierGranted: true, family: { story_allowance: { allowance: 1, used: 1, reset: 'lifetime' } } });
    await bench.drain();
    expect(await stories.using(bench.db).require(storyId)).toMatchObject({
      status: 'complete',
      allowance: { charged: false, remaining: 0 },
    });
  });

  it('tidies model text like today (synopsis punctuation, quoted titles)', () => {
    expect(tidySynopsis('A tale of two friends who find a key')).toBe('A tale of two friends who find a key.');
    expect(tidySynopsis('Short')).toBe('A delightful adventure story for young readers.');
    expect(tidyTitle('"The Moon"\nextra')).toBe('The Moon');
    expect(tidyTitle('')).toBe('My Story');
  });
});
