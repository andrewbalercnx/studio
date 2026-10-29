/**
 * Dispatchers deliver "run job X" to the runner.
 *
 * - `InProcessDispatcher`: runs the job in this process (tests, local dev, and
 *   the emulator end-to-end run), same interface as Cloud Tasks.
 * - `CloudTasksDispatcher`: one Cloud Task per job attempt, HTTP target
 *   `/api/internal/jobs/run` with an OIDC token for the invoker service
 *   account, on the queue for the job kind's resource group (ADR-0002).
 */
import type { QueueGroup } from './registry';

export type DispatchRequest = {
  jobId: string;
  kind: string;
  /** Attempts started so far; part of the Cloud Task name so duplicates are rejected. */
  attempt: number;
  queue: QueueGroup;
  /** Deliver no earlier than this many ms from now (retry backoff). */
  delayMs?: number;
};

export type RunJobFn = (jobId: string) => Promise<unknown>;

export interface Dispatcher {
  dispatch(request: DispatchRequest): Promise<void>;
  /** In-process dispatchers receive the runner's `runJob` when the runner is created. */
  attach?(run: RunJobFn): void;
}

// ---------------------------------------------------------------------------
// In-process
// ---------------------------------------------------------------------------

export type InProcessDispatcherOptions = {
  /** Delay implementation; tests pass a no-op so retries run immediately. */
  sleep?: (ms: number) => Promise<void>;
};

export class InProcessDispatcher implements Dispatcher {
  private run: RunJobFn | null = null;
  private readonly pending = new Set<Promise<void>>();
  private readonly sleep: (ms: number) => Promise<void>;
  readonly dispatched: DispatchRequest[] = [];

  constructor(options: InProcessDispatcherOptions = {}) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  attach(run: RunJobFn): void {
    this.run = run;
  }

  async dispatch(request: DispatchRequest): Promise<void> {
    const run = this.run;
    if (!run) throw new Error('InProcessDispatcher is not attached to a job runner');
    this.dispatched.push(request);
    // Run asynchronously, like a queue: the caller's request is not blocked.
    const task: Promise<void> = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (request.delayMs && request.delayMs > 0) await this.sleep(request.delayMs);
      await run(request.jobId);
    })()
      .catch((error) => console.error(`[jobs] in-process run of ${request.jobId} failed`, error))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Resolves once every dispatched job (and anything they dispatched) has finished. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

// ---------------------------------------------------------------------------
// Cloud Tasks
// ---------------------------------------------------------------------------

export type CloudTasksConfig = {
  project: string;
  location: string;
  /** Full URL of `/api/internal/jobs/run`. */
  runUrl: string;
  /** Service account the OIDC token is minted for (the job route checks it). */
  serviceAccountEmail: string;
  /** OIDC audience; the job route checks it. Defaults to `runUrl`. */
  audience: string;
  /** Optional prefix for queue ids, e.g. `storypic-` → `storypic-ai-image`. */
  queuePrefix: string;
};

/**
 * Reads Cloud Tasks settings from env:
 * JOBS_TASKS_PROJECT (or GOOGLE_CLOUD_PROJECT / GCP_PROJECT_ID), JOBS_TASKS_LOCATION
 * (default us-central1), JOBS_RUN_URL, JOBS_INVOKER_SERVICE_ACCOUNT,
 * JOBS_OIDC_AUDIENCE (default JOBS_RUN_URL), JOBS_QUEUE_PREFIX (optional).
 */
export function readCloudTasksConfig(env: Record<string, string | undefined> = process.env): CloudTasksConfig {
  const project = env.JOBS_TASKS_PROJECT || env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT_ID;
  const runUrl = env.JOBS_RUN_URL;
  const serviceAccountEmail = env.JOBS_INVOKER_SERVICE_ACCOUNT;
  const missing = [
    !project && 'JOBS_TASKS_PROJECT',
    !runUrl && 'JOBS_RUN_URL',
    !serviceAccountEmail && 'JOBS_INVOKER_SERVICE_ACCOUNT',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Cloud Tasks dispatcher is not configured; missing ${missing.join(', ')}`);
  }
  return {
    project: project!,
    location: env.JOBS_TASKS_LOCATION || 'us-central1',
    runUrl: runUrl!,
    serviceAccountEmail: serviceAccountEmail!,
    audience: env.JOBS_OIDC_AUDIENCE || runUrl!,
    queuePrefix: env.JOBS_QUEUE_PREFIX || '',
  };
}

/** The slice of `CloudTasksClient` the dispatcher uses (injectable for tests). */
export type CloudTasksClientLike = {
  queuePath(project: string, location: string, queue: string): string;
  createTask(request: { parent: string; task: Record<string, unknown> }): Promise<unknown>;
};

const GRPC_ALREADY_EXISTS = 6;

export class CloudTasksDispatcher implements Dispatcher {
  private client: CloudTasksClientLike | null;

  constructor(
    private readonly config: CloudTasksConfig,
    client?: CloudTasksClientLike,
    private readonly now: () => number = Date.now
  ) {
    this.client = client ?? null;
  }

  private async getClient(): Promise<CloudTasksClientLike> {
    if (!this.client) {
      const { CloudTasksClient } = await import('@google-cloud/tasks');
      this.client = new CloudTasksClient() as unknown as CloudTasksClientLike;
    }
    return this.client;
  }

  queueId(queue: QueueGroup): string {
    return `${this.config.queuePrefix}${queue}`;
  }

  async dispatch(request: DispatchRequest): Promise<void> {
    const client = await this.getClient();
    const parent = client.queuePath(this.config.project, this.config.location, this.queueId(request.queue));
    const task: Record<string, unknown> = {
      // One task per job attempt: re-dispatching the same attempt is rejected as a duplicate.
      name: `${parent}/tasks/${request.jobId}-${request.attempt}`,
      httpRequest: {
        httpMethod: 'POST',
        url: this.config.runUrl,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ jobId: request.jobId })).toString('base64'),
        oidcToken: {
          serviceAccountEmail: this.config.serviceAccountEmail,
          audience: this.config.audience,
        },
      },
    };
    if (request.delayMs && request.delayMs > 0) {
      task.scheduleTime = { seconds: Math.ceil((this.now() + request.delayMs) / 1000) };
    }
    try {
      await client.createTask({ parent, task });
    } catch (error) {
      if ((error as { code?: unknown })?.code === GRPC_ALREADY_EXISTS) return;
      throw error;
    }
  }
}

/** `JOBS_DISPATCHER=cloud-tasks` selects Cloud Tasks; anything else runs jobs in-process. */
export function createDispatcherFromEnv(env: Record<string, string | undefined> = process.env): Dispatcher {
  if (env.JOBS_DISPATCHER === 'cloud-tasks') {
    return new CloudTasksDispatcher(readCloudTasksConfig(env));
  }
  return new InProcessDispatcher();
}
