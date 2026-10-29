import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { jobs as jobsRepository } from '../../data/repositories';
import { FakeFirestore } from '../../testing/fake-firestore';
import { InProcessDispatcher } from '../dispatcher';
import { JobFailure, JobRegistry, type JobSpec } from '../registry';
import { JobRunner, defaultIdempotencyKey, jobIdFor, toJobError } from '../runner';

/**
 * The runner suite runs against the in-memory fake always, and also against
 * the Firestore emulator when FIRESTORE_EMULATOR_HOST is set:
 *   npx --yes firebase-tools@15.20.0 emulators:exec --only firestore --project demo-x \
 *     "npx vitest run src/server/jobs"
 */
type Backend = { name: string; create: () => Promise<Firestore>; reset: () => Promise<void> };

const fakeBackend = (): Backend => {
  let fake = new FakeFirestore(() => Date.now());
  return {
    name: 'fake',
    create: async () => fake.asFirestore(),
    reset: async () => {
      fake = new FakeFirestore(() => Date.now());
    },
  };
};

const emulatorBackend = (): Backend => {
  const projectId = 'demo-x';
  let db: Firestore | null = null;
  return {
    name: 'emulator',
    create: async () => {
      if (!db) {
        const { initializeApp, getApps } = await import('firebase-admin/app');
        const { getFirestore } = await import('firebase-admin/firestore');
        const app = getApps().find((a) => a.name === 'jobs-emulator') ?? initializeApp({ projectId }, 'jobs-emulator');
        db = getFirestore(app);
      }
      return db;
    },
    reset: async () => {
      await fetch(
        `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        { method: 'DELETE' }
      );
    },
  };
};

const backends: Backend[] = [fakeBackend(), ...(process.env.FIRESTORE_EMULATOR_HOST ? [emulatorBackend()] : [])];

describe.each(backends)('JobRunner ($name)', (backend) => {
  let db: Firestore;
  let now: number;
  let registry: JobRegistry;
  let dispatcher: InProcessDispatcher;
  let runner: JobRunner;
  let calls: string[];
  let flakyFailures: number;
  let fanIns: Array<{ parent: string; statuses: string[] }>;

  const jobsRepo = () => jobsRepository.using(db);
  const spec = (kind: string, id = 't1', input: Record<string, unknown> = {}): JobSpec => ({
    kind,
    ownerUid: 'u1',
    target: { collection: 'books', id },
    input,
  });

  beforeEach(async () => {
    await backend.reset();
    db = await backend.create();
    now = 1_700_000_000_000;
    calls = [];
    flakyFailures = 0;
    fanIns = [];
    registry = new JobRegistry()
      .register({
        kind: 'test.echo',
        queue: 'ai-text',
        run: async ({ job }) => {
          calls.push(`echo:${job.target.id}:${job.attempt}`);
        },
      })
      .register({
        kind: 'test.flaky',
        queue: 'ai-image',
        maxAttempts: 3,
        run: async ({ job }) => {
          calls.push(`flaky:${job.attempt}`);
          if (flakyFailures > 0) {
            flakyFailures -= 1;
            throw new Error('503 UNAVAILABLE');
          }
        },
      })
      .register({
        kind: 'test.permanent',
        queue: 'ai-text',
        run: async () => {
          calls.push('permanent');
          throw new Error('400 INVALID_ARGUMENT: bad prompt');
        },
      })
      .register({
        kind: 'test.parent',
        queue: 'render',
        run: async ({ job, enqueueChildren }) => {
          calls.push('parent');
          const pages = (job.input.pages as string[]) ?? [];
          await enqueueChildren(
            pages.map((page) => ({
              kind: page.startsWith('bad') ? 'test.permanent' : 'test.echo',
              ownerUid: job.ownerUid,
              target: { collection: 'books', id: job.target.id, subpath: `pages/${page}` },
              input: { page },
            }))
          );
        },
        onChildrenComplete: async ({ parent, children }) => {
          fanIns.push({ parent: parent.jobId, statuses: children.map((c) => c.status).sort() });
          const failed = children.filter((c) => c.status === 'failed').length;
          return {
            enqueue: [{ kind: 'test.echo', ownerUid: parent.ownerUid, target: { collection: 'books', id: `${parent.target.id}-render` } }],
            apply: (tx) => {
              tx.set(db.doc(`books/${parent.target.id}`), { status: failed ? 'partial' : 'ready' });
            },
          };
        },
      });
    dispatcher = new InProcessDispatcher({ sleep: async () => undefined });
    runner = new JobRunner({ registry, dispatcher, db, now: () => now, retryDelayMs: () => 1_000 });
  });

  afterAll(async () => {
    await backend.reset();
  });

  it('creates a queued job with an id derived from the idempotency key, once', async () => {
    const [first] = await runner.enqueue([spec('test.echo')]);
    expect(first.created).toBe(true);
    expect(first.jobId).toBe(jobIdFor(defaultIdempotencyKey(spec('test.echo'))));
    await dispatcher.drain();

    const [second] = await runner.enqueue([spec('test.echo')]);
    expect(second).toEqual({ jobId: first.jobId, created: false, status: 'succeeded' });
    await dispatcher.drain();

    expect(calls).toEqual(['echo:t1:1']);
    const job = await jobsRepo().require(first.jobId);
    expect(job).toMatchObject({ status: 'succeeded', attempt: 1, maxAttempts: 3, ownerUid: 'u1', leaseUntil: null });
    expect(job.finishedAt).toBeInstanceOf(Timestamp);
  });

  it('dedupes identical specs within one enqueue and separates different inputs', async () => {
    const results = await runner.enqueue([spec('test.echo', 'a'), spec('test.echo', 'a'), spec('test.echo', 'a', { v: 2 })]);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.jobId)).size).toBe(2);
    await dispatcher.drain();
  });

  it('rejects unknown kinds at enqueue', async () => {
    await expect(runner.enqueue([spec('nope')])).rejects.toThrow(/not registered/);
  });

  it('skips terminal jobs on redelivery', async () => {
    const [{ jobId }] = await runner.enqueue([spec('test.echo')]);
    await dispatcher.drain();
    await expect(runner.runJob(jobId)).resolves.toEqual({ outcome: 'skipped', jobId, status: 'succeeded' });
    expect(calls).toHaveLength(1);
    await expect(runner.runJob('job_missing')).resolves.toEqual({ outcome: 'missing', jobId: 'job_missing' });
  });

  it('reports busy while another runner holds an unexpired lease, and takes over once it expires', async () => {
    const tx = await db.runTransaction((t) => runner.enqueueInTransaction(t, [spec('test.echo')]));
    const jobId = tx.jobs[0].jobId;
    await jobsRepo().update(jobId, { status: 'running', attempt: 1, leaseUntil: Timestamp.fromMillis(now + 60_000) });

    const busy = await runner.runJob(jobId);
    expect(busy).toEqual({ outcome: 'busy', jobId, leaseUntilMs: now + 60_000 });
    expect(calls).toEqual([]);

    now += 61_000;
    await expect(runner.runJob(jobId)).resolves.toEqual({ outcome: 'succeeded', jobId });
    expect(calls).toEqual(['echo:t1:2']);
  });

  it('fails a job whose last attempt lease expired', async () => {
    const { jobs } = await db.runTransaction((t) => runner.enqueueInTransaction(t, [{ ...spec('test.echo'), maxAttempts: 1 }]));
    const jobId = jobs[0].jobId;
    await jobsRepo().update(jobId, { status: 'running', attempt: 1, leaseUntil: Timestamp.fromMillis(now - 1) });
    const outcome = await runner.runJob(jobId);
    expect(outcome).toMatchObject({ outcome: 'failed', error: { code: 'LEASE_EXPIRED', retryable: false } });
    expect(calls).toEqual([]);
  });

  it('retries retryable failures with backoff until success', async () => {
    flakyFailures = 2;
    const [{ jobId }] = await runner.enqueue([spec('test.flaky')]);
    await dispatcher.drain();

    expect(calls).toEqual(['flaky:1', 'flaky:2', 'flaky:3']);
    const job = await jobsRepo().require(jobId);
    expect(job.status).toBe('succeeded');
    expect(job.attempt).toBe(3);
    expect(job.error).toBeNull();
    // initial dispatch + two delayed re-dispatches, one Cloud Task name per attempt
    expect(dispatcher.dispatched.map((d) => [d.attempt, d.delayMs ?? 0, d.queue])).toEqual([
      [0, 0, 'ai-image'],
      [1, 1_000, 'ai-image'],
      [2, 1_000, 'ai-image'],
    ]);
  });

  it('fails after maxAttempts retryable failures', async () => {
    flakyFailures = 5;
    const [{ jobId }] = await runner.enqueue([spec('test.flaky')]);
    await dispatcher.drain();
    expect(calls).toEqual(['flaky:1', 'flaky:2', 'flaky:3']);
    const job = await jobsRepo().require(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toEqual({ code: 'TRANSIENT', message: '503 UNAVAILABLE', retryable: true });
  });

  it('fails permanent errors on the first attempt', async () => {
    const [{ jobId }] = await runner.enqueue([spec('test.permanent')]);
    await dispatcher.drain();
    expect(calls).toEqual(['permanent']);
    expect((await jobsRepo().require(jobId)).error).toMatchObject({ code: 'HANDLER_ERROR', retryable: false });
  });

  it('does not overwrite a job whose lease was taken away mid-run', async () => {
    registry.register({
      kind: 'test.cancelled',
      queue: 'ai-text',
      run: async ({ job }) => {
        await jobsRepository.using(db).update(job.jobId, { status: 'cancelled' });
      },
    });
    const { jobs } = await db.runTransaction((t) => runner.enqueueInTransaction(t, [spec('test.cancelled')]));
    await expect(runner.runJob(jobs[0].jobId)).resolves.toEqual({ outcome: 'lease_lost', jobId: jobs[0].jobId });
    expect((await jobsRepo().require(jobs[0].jobId)).status).toBe('cancelled');
  });

  it('creates jobs in the caller transaction alongside the entity change', async () => {
    const pending = await db.runTransaction(async (t) => {
      const result = await runner.enqueueInTransaction(t, [spec('test.echo', 'b1')]);
      t.set(db.doc('books/b1'), { status: 'illustrating' });
      return result;
    });
    expect((await db.doc('books/b1').get()).data()).toEqual({ status: 'illustrating' });
    expect(calls).toEqual([]);
    await pending.dispatch();
    await dispatcher.drain();
    expect(calls).toEqual(['echo:b1:1']);
  });

  it('fans in once when the coordinator and all children are terminal', async () => {
    const [{ jobId: parentId }] = await runner.enqueue([spec('test.parent', 'b2', { pages: ['p1', 'p2', 'bad3'] })]);
    await dispatcher.drain();

    // onChildrenComplete may be re-invoked if the transaction retries on contention
    // (the emulator does this); its effects commit exactly once.
    expect(fanIns.length).toBeGreaterThanOrEqual(1);
    for (const call of fanIns) expect(call).toEqual({ parent: parentId, statuses: ['failed', 'succeeded', 'succeeded'] });
    const parent = await jobsRepo().require(parentId);
    expect(parent.status).toBe('succeeded');
    expect(parent.fanInCompletedAt).toBeInstanceOf(Timestamp);
    const children = await jobsRepo().where({ parentJobId: parentId });
    expect(children).toHaveLength(3);
    expect((await db.doc('books/b2').get()).data()).toEqual({ status: 'partial' });
    // the job returned by onChildrenComplete ran too
    expect(calls).toContain('echo:b2-render:1');

    expect(calls.filter((c) => c === 'echo:b2-render:1')).toHaveLength(1);
    const before = fanIns.length;
    await expect(runner.fanIn(parentId)).resolves.toBe(false);
    expect(fanIns).toHaveLength(before);
  });

  it('does not fan in while a child is still running', async () => {
    const [{ jobId: parentId }] = await runner.enqueue([spec('test.parent', 'b3', { pages: [] })]);
    await dispatcher.drain();
    // no children → nothing to wait for
    expect(fanIns).toEqual([]);

    const { jobs } = await db.runTransaction((t) =>
      runner.enqueueInTransaction(t, [{ ...spec('test.echo', 'b3', { page: 'x' }), parentJobId: parentId }])
    );
    await expect(runner.fanIn(parentId)).resolves.toBe(false);
    await runner.runJob(jobs[0].jobId);
    expect(fanIns).toEqual([{ parent: parentId, statuses: ['succeeded'] }]);
    await dispatcher.drain();
  });
});

describe('toJobError', () => {
  it('honours JobFailure and classifies other errors', () => {
    expect(toJobError(new JobFailure('NO_PHOTOS', 'none', { retryable: false }))).toEqual({
      code: 'NO_PHOTOS',
      message: 'none',
      retryable: false,
    });
    expect(toJobError(new Error('429 RESOURCE_EXHAUSTED'))).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(toJobError(new Error('ETIMEDOUT'))).toMatchObject({ code: 'TRANSIENT', retryable: true });
    expect(toJobError(new Error('mystery'))).toMatchObject({ code: 'HANDLER_ERROR', retryable: false });
  });
});
