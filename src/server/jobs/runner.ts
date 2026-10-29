/**
 * The job runner (pipeline.md, ADR-0002/0003).
 *
 *   enqueue(specs)      create Job docs (idempotent on idempotencyKey) and dispatch them
 *   runJob(jobId)       lease → run handler → record outcome → retry / fan-in
 *
 * Guarantees:
 * - Job ids are derived from the idempotency key, so enqueueing the same work
 *   twice (double click, retried request) yields the same job.
 * - A job runs only under a lease taken in a transaction. A second delivery
 *   while the lease is held is reported as `busy` (the job route answers 409
 *   so Cloud Tasks redelivers later); a crashed runner's lease expires and the
 *   next delivery takes over.
 * - Outcomes are written only if this runner still holds the lease (same
 *   attempt, still `running`), so a late runner cannot overwrite a newer one.
 * - Retryable failures go back to `queued` and are re-dispatched with backoff
 *   until `maxAttempts`; then the job is `failed`.
 * - Fan-in: when a coordinator job has succeeded and all its children are
 *   terminal, its kind's `onChildrenComplete` runs exactly once, in the
 *   transaction that records it, and the jobs it returns are created there too.
 */
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { classifyError, computeBackoffMs } from '@/lib/ai-retry';
import { isAppError } from '../errors';
import { resolveDb, type DbSource } from '../data/db';
import { jobs as jobsRepository } from '../data/repositories';
import type { CreateInput, Repository, WithId } from '../data/repository';
import { isTerminalJobStatus, jobSchema, type Job, type JobError, type JobTarget } from '../data/schemas/job';
import type { Dispatcher, DispatchRequest } from './dispatcher';
import {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  JobFailure,
  type EnqueueResult,
  type JobRegistry,
  type JobSpec,
} from './registry';

export type RunOutcome =
  | { outcome: 'missing'; jobId: string }
  | { outcome: 'skipped'; jobId: string; status: Job['status'] }
  | { outcome: 'busy'; jobId: string; leaseUntilMs: number }
  | { outcome: 'succeeded'; jobId: string }
  | { outcome: 'retry_scheduled'; jobId: string; delayMs: number; error: JobError }
  | { outcome: 'failed'; jobId: string; error: JobError }
  | { outcome: 'lease_lost'; jobId: string };

export type JobRunnerOptions = {
  registry: JobRegistry;
  dispatcher: Dispatcher;
  db?: DbSource;
  now?: () => number;
  /** Retry backoff (ms) after attempt `n` (1-based) failed. */
  retryDelayMs?: (attempt: number, error: JobError) => number;
};

type PreparedSpec = { jobId: string; data: CreateInput<typeof jobSchema> };
type CreatedJob = EnqueueResult & { dispatch: DispatchRequest | null };

/** Deterministic JSON (sorted keys) so equal inputs hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function targetKey(target: JobTarget): string {
  return `${target.collection}/${target.id}${target.subpath ? `/${target.subpath}` : ''}`;
}

/** `${kind}:${target}:${inputsHash}` (pipeline.md). */
export function defaultIdempotencyKey(spec: Pick<JobSpec, 'kind' | 'target' | 'input'>): string {
  return `${spec.kind}:${targetKey(spec.target)}:${sha256(stableStringify(spec.input ?? {})).slice(0, 16)}`;
}

/** Job ids are derived from the idempotency key: same key ⇒ same document. */
export function jobIdFor(idempotencyKey: string): string {
  return `job_${sha256(idempotencyKey).slice(0, 32)}`;
}

/** Map any handler error to the stored `{ code, message, retryable }`. */
export function toJobError(error: unknown): JobError {
  if (error instanceof JobFailure) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  const message = (error as Error)?.message ?? String(error);
  if (isAppError(error)) {
    return { code: error.code, message, retryable: false };
  }
  const errorClass = classifyError(error);
  if (errorClass === 'rate_limit') return { code: 'RATE_LIMITED', message, retryable: true };
  if (errorClass === 'transient') return { code: 'TRANSIENT', message, retryable: true };
  return { code: 'HANDLER_ERROR', message, retryable: false };
}

function defaultRetryDelayMs(attempt: number, error: JobError): number {
  const baseMs = error.code === 'RATE_LIMITED' ? 30_000 : 5_000;
  return Math.max(1_000, computeBackoffMs(attempt - 1, { baseMs, capMs: 10 * 60_000 }));
}

export class JobRunner {
  readonly registry: JobRegistry;
  private readonly dispatcher: Dispatcher;
  private readonly dbSource: DbSource | undefined;
  private readonly jobs: Repository<typeof jobSchema>;
  private readonly now: () => number;
  private readonly retryDelayMs: (attempt: number, error: JobError) => number;

  constructor(options: JobRunnerOptions) {
    this.registry = options.registry;
    this.dispatcher = options.dispatcher;
    this.dbSource = options.db;
    this.jobs = options.db ? jobsRepository.using(options.db) : jobsRepository;
    this.now = options.now ?? Date.now;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.dispatcher.attach?.((jobId) => this.runJob(jobId));
  }

  private db(): Promise<Firestore> {
    return resolveDb(this.dbSource);
  }

  // ---------------------------------------------------------------------------
  // Enqueue
  // ---------------------------------------------------------------------------

  private prepare(specs: JobSpec[]): PreparedSpec[] {
    const seen = new Set<string>();
    const prepared: PreparedSpec[] = [];
    for (const spec of specs) {
      const definition = this.registry.require(spec.kind);
      const idempotencyKey = spec.idempotencyKey ?? defaultIdempotencyKey(spec);
      const jobId = jobIdFor(idempotencyKey);
      if (seen.has(jobId)) continue;
      seen.add(jobId);
      prepared.push({
        jobId,
        data: {
          ownerUid: spec.ownerUid,
          jobId,
          kind: spec.kind,
          target: spec.target,
          input: spec.input ?? {},
          status: 'queued',
          attempt: 0,
          maxAttempts: spec.maxAttempts ?? definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          parentJobId: spec.parentJobId ?? null,
          idempotencyKey,
        },
      });
    }
    return prepared;
  }

  /** Reads first (all job refs), then writes; safe to call before the caller's own writes. */
  private async createJobsIn(tx: Transaction, prepared: PreparedSpec[]): Promise<CreatedJob[]> {
    if (prepared.length === 0) return [];
    const refs = await Promise.all(prepared.map((p) => this.jobs.ref(p.jobId)));
    const snapshots = await tx.getAll(...refs);
    const results: CreatedJob[] = [];
    for (let i = 0; i < prepared.length; i++) {
      const { jobId, data } = prepared[i];
      const snapshot = snapshots[i];
      const queue = this.registry.require(data.kind).queue;
      if (!snapshot.exists) {
        await this.jobs.createIn(tx, data, { id: jobId });
        results.push({ jobId, created: true, status: 'queued', dispatch: { jobId, kind: data.kind, attempt: 0, queue } });
        continue;
      }
      const existing = this.jobs.parse(snapshot);
      // A queued job is re-dispatched: harmless (the lease decides) and it
      // recovers a dispatch that was lost after the creating commit.
      const dispatch =
        existing.status === 'queued'
          ? { jobId, kind: existing.kind, attempt: existing.attempt, queue }
          : null;
      results.push({ jobId, created: false, status: existing.status, dispatch });
    }
    return results;
  }

  private async dispatchAll(created: CreatedJob[]): Promise<void> {
    for (const job of created) {
      if (!job.dispatch) continue;
      try {
        await this.dispatcher.dispatch(job.dispatch);
      } catch (error) {
        // The job document exists and stays `queued`; enqueueing it again re-dispatches.
        console.error(`[jobs] Failed to dispatch ${job.jobId}`, error);
      }
    }
  }

  private strip(created: CreatedJob[]): EnqueueResult[] {
    return created.map(({ jobId, created: isNew, status }) => ({ jobId, created: isNew, status }));
  }

  /** Create jobs (one transaction) and dispatch them. */
  async enqueue(specs: JobSpec[]): Promise<EnqueueResult[]> {
    const prepared = this.prepare(specs);
    if (prepared.length === 0) return [];
    const db = await this.db();
    const created = await db.runTransaction((tx) => this.createJobsIn(tx, prepared));
    await this.dispatchAll(created);
    return this.strip(created);
  }

  /**
   * Create jobs inside the caller's transaction, together with the entity
   * change that needs them (pipeline.md). Call it BEFORE the transaction's
   * writes (it reads), and call `dispatch()` after the transaction commits.
   */
  async enqueueInTransaction(
    tx: Transaction,
    specs: JobSpec[]
  ): Promise<{ jobs: EnqueueResult[]; dispatch: () => Promise<void> }> {
    const created = await this.createJobsIn(tx, this.prepare(specs));
    return { jobs: this.strip(created), dispatch: () => this.dispatchAll(created) };
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  async runJob(jobId: string): Promise<RunOutcome> {
    const db = await this.db();

    type Lease =
      | { kind: 'done'; outcome: RunOutcome; terminal?: WithId<Job> }
      | { kind: 'leased'; job: WithId<Job> };

    const lease: Lease = await db.runTransaction(async (tx): Promise<Lease> => {
      const job = await this.jobs.getIn(tx, jobId);
      if (!job) return { kind: 'done', outcome: { outcome: 'missing', jobId } };
      if (isTerminalJobStatus(job.status)) {
        return { kind: 'done', outcome: { outcome: 'skipped', jobId, status: job.status } };
      }
      const now = this.now();
      if (job.status === 'running' && job.leaseUntil && job.leaseUntil.toMillis() > now) {
        return { kind: 'done', outcome: { outcome: 'busy', jobId, leaseUntilMs: job.leaseUntil.toMillis() } };
      }
      const definition = this.registry.get(job.kind);
      let fatal: JobError | null = null;
      if (!definition) {
        fatal = { code: 'UNKNOWN_KIND', message: `Job kind "${job.kind}" is not registered`, retryable: false };
      } else if (job.attempt >= job.maxAttempts) {
        // Only reachable when the last attempt's lease expired (runner crashed).
        fatal = { code: 'LEASE_EXPIRED', message: 'The last attempt did not finish before its lease expired', retryable: false };
      }
      if (fatal) {
        await this.jobs.updateIn(tx, jobId, {
          status: 'failed',
          error: fatal,
          leaseUntil: null,
          finishedAt: FieldValue.serverTimestamp(),
        });
        return { kind: 'done', outcome: { outcome: 'failed', jobId, error: fatal }, terminal: job };
      }
      const attempt = job.attempt + 1;
      const leaseUntil = Timestamp.fromMillis(now + (definition!.leaseMs ?? DEFAULT_LEASE_MS));
      await this.jobs.updateIn(tx, jobId, {
        status: 'running',
        attempt,
        leaseUntil,
        ...(job.startedAt ? {} : { startedAt: FieldValue.serverTimestamp() }),
      });
      return { kind: 'leased', job: { ...job, status: 'running', attempt, leaseUntil } };
    });

    if (lease.kind === 'done') {
      if (lease.terminal?.parentJobId) await this.fanIn(lease.terminal.parentJobId);
      return lease.outcome;
    }

    const job = lease.job;
    const definition = this.registry.require(job.kind);
    let failure: JobError | null = null;
    try {
      await definition.run({
        job,
        db,
        enqueue: (specs) => this.enqueue(specs),
        enqueueChildren: (specs) => this.enqueue(specs.map((spec) => ({ ...spec, parentJobId: job.jobId }))),
      });
    } catch (error) {
      failure = toJobError(error);
      console.warn(`[jobs] ${job.kind} ${jobId} attempt ${job.attempt} failed: ${failure.code} ${failure.message}`);
    }

    return failure ? this.recordFailure(job, failure) : this.recordSuccess(job);
  }

  /** True when `current` is still the attempt this runner leased. */
  private holdsLease(current: WithId<Job> | null, leased: WithId<Job>): current is WithId<Job> {
    return !!current && current.status === 'running' && current.attempt === leased.attempt;
  }

  private async recordSuccess(leased: WithId<Job>): Promise<RunOutcome> {
    const db = await this.db();
    const recorded = await db.runTransaction(async (tx) => {
      const current = await this.jobs.getIn(tx, leased.jobId);
      if (!this.holdsLease(current, leased)) return false;
      await this.jobs.updateIn(tx, leased.jobId, {
        status: 'succeeded',
        error: null,
        leaseUntil: null,
        finishedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!recorded) return { outcome: 'lease_lost', jobId: leased.jobId };

    // Whichever finishes last (the coordinator or its last child) triggers the fan-in.
    await this.fanIn(leased.jobId);
    if (leased.parentJobId) await this.fanIn(leased.parentJobId);
    return { outcome: 'succeeded', jobId: leased.jobId };
  }

  private async recordFailure(leased: WithId<Job>, error: JobError): Promise<RunOutcome> {
    const db = await this.db();
    const retry = error.retryable && leased.attempt < leased.maxAttempts;
    const recorded = await db.runTransaction(async (tx) => {
      const current = await this.jobs.getIn(tx, leased.jobId);
      if (!this.holdsLease(current, leased)) return false;
      await this.jobs.updateIn(
        tx,
        leased.jobId,
        retry
          ? { status: 'queued', error, leaseUntil: null }
          : { status: 'failed', error, leaseUntil: null, finishedAt: FieldValue.serverTimestamp() }
      );
      return true;
    });
    if (!recorded) return { outcome: 'lease_lost', jobId: leased.jobId };

    if (retry) {
      const delayMs = this.retryDelayMs(leased.attempt, error);
      await this.dispatchAll([
        {
          jobId: leased.jobId,
          created: false,
          status: 'queued',
          dispatch: {
            jobId: leased.jobId,
            kind: leased.kind,
            attempt: leased.attempt,
            queue: this.registry.require(leased.kind).queue,
            delayMs,
          },
        },
      ]);
      return { outcome: 'retry_scheduled', jobId: leased.jobId, delayMs, error };
    }

    if (leased.parentJobId) await this.fanIn(leased.parentJobId);
    return { outcome: 'failed', jobId: leased.jobId, error };
  }

  // ---------------------------------------------------------------------------
  // Fan-in
  // ---------------------------------------------------------------------------

  /**
   * If `parentJobId` has succeeded, has children, and every child is terminal,
   * run its kind's `onChildrenComplete` once: the marker, the next jobs and any
   * extra writes commit in one transaction. Returns whether it ran.
   */
  async fanIn(parentJobId: string): Promise<boolean> {
    const db = await this.db();
    const collection = await this.jobs.collection();
    const { ran, created } = await db.runTransaction(async (tx) => {
      const none = { ran: false, created: [] as CreatedJob[] };
      const parent = await this.jobs.getIn(tx, parentJobId);
      if (!parent || parent.status !== 'succeeded' || parent.fanInCompletedAt) return none;
      const definition = this.registry.get(parent.kind);
      if (!definition?.onChildrenComplete) return none;

      const childSnapshot = await tx.get(collection.where('parentJobId', '==', parentJobId));
      const children = childSnapshot.docs.map((doc) => this.jobs.parse(doc));
      if (children.length === 0 || children.some((child) => !isTerminalJobStatus(child.status))) return none;

      const result = (await definition.onChildrenComplete({ tx, db, parent, children })) ?? {};
      // Reads for the next jobs happen here, before any write below.
      const next = await this.createJobsIn(tx, this.prepare(result.enqueue ?? []));
      await this.jobs.updateIn(tx, parentJobId, { fanInCompletedAt: FieldValue.serverTimestamp() });
      await result.apply?.(tx);
      return { ran: true, created: next };
    });
    await this.dispatchAll(created);
    return ran;
  }
}
