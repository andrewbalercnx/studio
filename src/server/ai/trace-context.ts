/**
 * What an AI call is working for, carried implicitly through async calls.
 *
 * The job runner sets it around every job (job id, kind, and the Book,
 * Manuscript or Story the job targets); creation sets it around a Story's
 * model calls. The harness copies it onto every `aiFlowLogs` entry, so one
 * Book's or Story's calls can be found without each caller passing ids.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type TraceContext = {
  jobId?: string;
  jobKind?: string;
  bookId?: string;
  manuscriptId?: string;
  storyId?: string;
};

const storage = new AsyncLocalStorage<TraceContext>();

/** Run `fn` with `context` added to (not replacing) the surrounding context. */
export function withTraceContext<T>(context: TraceContext, fn: () => T): T {
  const merged = { ...(storage.getStore() ?? {}), ...stripEmpty(context) };
  return storage.run(merged, fn);
}

export function currentTraceContext(): TraceContext {
  return storage.getStore() ?? {};
}

/** The ids a job's target and input name, by collection. */
export function traceContextForJob(job: {
  jobId: string;
  kind: string;
  target: { collection: string; id: string };
  input?: Record<string, unknown>;
}): TraceContext {
  const context: TraceContext = { jobId: job.jobId, jobKind: job.kind };
  const byCollection: Record<string, keyof TraceContext> = {
    books: 'bookId',
    manuscripts: 'manuscriptId',
    stories: 'storyId',
  };
  const key = byCollection[job.target.collection];
  if (key) context[key] = job.target.id;
  for (const field of ['bookId', 'manuscriptId', 'storyId'] as const) {
    const value = job.input?.[field];
    if (typeof value === 'string' && value && !context[field]) context[field] = value;
  }
  return context;
}

function stripEmpty(context: TraceContext): TraceContext {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => typeof value === 'string' && value)) as TraceContext;
}
