import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { WithId } from '../data/repository';
import type { Job, JobTarget } from '../data/schemas/job';

/** Cloud Tasks queues, one per kind of resource (pipeline.md). */
export const QUEUE_GROUPS = ['ai-text', 'ai-image', 'tts', 'render', 'mixam'] as const;
export type QueueGroup = (typeof QUEUE_GROUPS)[number];

/** What a caller asks for; the runner fills in ids, status and counters. */
export type JobSpec = {
  kind: string;
  ownerUid: string;
  target: JobTarget;
  input?: Record<string, unknown>;
  parentJobId?: string | null;
  /** Defaults to `${kind}:${target}:${hash(input)}`. Same key ⇒ same job. */
  idempotencyKey?: string;
  /** Overrides the kind's default. */
  maxAttempts?: number;
};

export type EnqueueResult = {
  jobId: string;
  /** False when a job with the same idempotency key already existed. */
  created: boolean;
  status: Job['status'];
};

export type JobContext = {
  job: WithId<Job>;
  db: Firestore;
  /** Enqueue follow-on jobs (not children). */
  enqueue: (specs: JobSpec[]) => Promise<EnqueueResult[]>;
  /**
   * Enqueue children of this job (`parentJobId` = this job). Enqueue all
   * children in one call, as the handler's last step; the kind's
   * `onChildrenComplete` runs once when this job has succeeded and every
   * child is terminal.
   */
  enqueueChildren: (specs: Omit<JobSpec, 'parentJobId'>[]) => Promise<EnqueueResult[]>;
};

export type FanInContext = {
  /** Read-only use: all transaction reads happen before the runner's writes. */
  tx: Transaction;
  parent: WithId<Job>;
  children: WithId<Job>[];
};

export type FanInResult = {
  /** Next jobs, created in the same transaction that records the fan-in. */
  enqueue?: JobSpec[];
  /** Extra writes in that transaction (e.g. move a Book to `ready` or `partial`). */
  apply?: (tx: Transaction) => void | Promise<void>;
};

export type JobDefinition = {
  kind: string;
  queue: QueueGroup;
  /** Default 3. */
  maxAttempts?: number;
  /** How long a runner holds the job; default 6 minutes (longer than the 300 s request timeout). */
  leaseMs?: number;
  /** Do the unit of work. Throw `JobFailure` to control retryability; other errors are classified. */
  run: (ctx: JobContext) => Promise<void>;
  /**
   * Fan-in: runs in a transaction when this job succeeded and all its children
   * are terminal; its result commits exactly once. Like any transaction body
   * it may be re-invoked if the transaction retries, so it must have no side
   * effects of its own: express them as `enqueue` / `apply`.
   */
  onChildrenComplete?: (ctx: FanInContext) => FanInResult | void | Promise<FanInResult | void>;
};

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_LEASE_MS = 6 * 60_000;

/** Maps job kind → handler. Phase 5 slices register their kinds on `jobRegistry`. */
export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition>();

  register(definition: JobDefinition): this {
    if (this.definitions.has(definition.kind)) {
      throw new Error(`Job kind "${definition.kind}" is already registered`);
    }
    this.definitions.set(definition.kind, definition);
    return this;
  }

  get(kind: string): JobDefinition | undefined {
    return this.definitions.get(kind);
  }

  require(kind: string): JobDefinition {
    const definition = this.definitions.get(kind);
    if (!definition) throw new Error(`Job kind "${kind}" is not registered`);
    return definition;
  }

  kinds(): string[] {
    return [...this.definitions.keys()];
  }
}

/** Failure thrown by a handler with an explicit code and retry decision. */
export class JobFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'JobFailure';
    this.code = code;
    this.retryable = options.retryable;
  }
}
