import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { buildTrace } from '../trace';

const t = (seconds: number) => Timestamp.fromMillis(Date.UTC(2026, 10, 1, 12, 0, seconds));

function seed() {
  const fake = new FakeFirestore();
  fake.store.set('books/bk_1', { ownerUid: 'p1', storyId: 'st_1', manuscriptId: 'ms_1', styleId: 'w', status: 'illustrating', art: { total: 2, done: 1, failed: 0 }, createdAt: t(10), updatedAt: t(40) });
  fake.store.set('stories/st_1', { ownerUid: 'p1', status: 'complete', modeId: 'wizard', title: 'The Gate', createdAt: t(0), completedAt: t(8) });
  fake.store.set('jobs/j1', { jobId: 'j1', kind: 'manuscript.paginate', target: { collection: 'manuscripts', id: 'ms_1' }, status: 'succeeded', attempt: 1, maxAttempts: 3, createdAt: t(10), startedAt: t(12), finishedAt: t(20) });
  fake.store.set('jobs/j2', { jobId: 'j2', kind: 'book.pageArt', target: { collection: 'books', id: 'bk_1', subpath: 'pages/2' }, status: 'failed', attempt: 3, maxAttempts: 3, parentJobId: 'j9', error: { code: 'TRANSIENT', message: '503', retryable: true }, createdAt: t(21), startedAt: t(30), finishedAt: t(40) });
  fake.store.set('jobs/other', { jobId: 'other', kind: 'book.pageArt', target: { collection: 'books', id: 'bk_other' }, status: 'queued', attempt: 0, maxAttempts: 3, createdAt: t(21) });
  fake.store.set('aiFlowLogs/a1', { flowName: 'manuscript.paginate', purpose: 'manuscript.text', manuscriptId: 'ms_1', jobId: 'j1', status: 'success', modelName: 'googleai/gemini-3.8-flash', latencyMs: 7000, usage: { inputTokens: 1000, outputTokens: 500, thoughtsTokens: 100 }, prompt: 'p', createdAt: t(19) });
  fake.store.set('aiFlowLogs/a2', { flowName: 'book.pageArt', purpose: 'book.pageArt', bookId: 'bk_1', jobId: 'j2', status: 'error', errorMessage: 'FAILED_PRECONDITION: Generation blocked', latencyMs: 9000, prompt: 'draw', createdAt: t(39) });
  fake.store.set('aiFlowLogs/a3', { flowName: 'story.turn', purpose: 'creation.text', storyId: 'st_1', status: 'success', latencyMs: 3000, usage: { inputTokens: 200, outputTokens: 50 }, prompt: 'q', createdAt: t(2) });
  fake.store.set('aiFlowLogs/unrelated', { flowName: 'x', bookId: 'bk_other', status: 'success', createdAt: t(5) });
  return fake.asFirestore();
}

describe('buildTrace', () => {
  it("collects a Book's jobs and AI calls, with its Story's and Manuscript's, and totals them", async () => {
    const trace = await buildTrace(seed(), { bookId: 'bk_1' });
    expect(trace.book).toMatchObject({ id: 'bk_1', status: 'illustrating', art: { total: 2, done: 1, failed: 0 } });
    expect(trace.story).toMatchObject({ id: 'st_1', title: 'The Gate' });
    expect(trace.jobs.map((j) => [j.jobId, j.waitMs, j.runMs])).toEqual([
      ['j1', 2000, 8000],
      ['j2', 9000, 10000],
    ]);
    expect(trace.jobs[1]).toMatchObject({ target: 'books/bk_1/pages/2', error: { code: 'TRANSIENT', message: '503' } });
    expect(trace.jobCounts).toEqual({ 'manuscript.paginate': { succeeded: 1 }, 'book.pageArt': { failed: 1 } });
    expect(trace.aiCalls.map((c) => c.id)).toEqual(['a3', 'a1', 'a2']);
    expect(trace.totals).toEqual({ calls: 3, failedCalls: 1, blockedCalls: 1, modelMs: 19000, inputTokens: 1200, outputTokens: 550, thoughtsTokens: 100 });
    expect(trace.totalsByPurpose['book.pageArt']).toMatchObject({ calls: 1, failedCalls: 1, blockedCalls: 1 });
    expect(trace.spanMs).toBe(38000); // first AI call (2 s) to the last job finishing (40 s)
  });

  it("traces a Story on its own, and 404s an unknown id", async () => {
    const db = seed();
    const trace = await buildTrace(db, { storyId: 'st_1' });
    expect(trace.book).toBeNull();
    expect(trace.aiCalls.map((c) => c.id)).toEqual(['a3']);
    await expect(buildTrace(db, { bookId: 'bk_missing' })).rejects.toMatchObject({ status: 404 });
  });
});
