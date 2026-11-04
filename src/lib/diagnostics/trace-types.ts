/**
 * The shape of GET /api/admin/trace (src/server/diagnostics/trace.ts), shared
 * with the admin trace page.
 */
export type TraceQuery = { bookId?: string; storyId?: string };

export type TraceJob = {
  jobId: string;
  kind: string;
  target: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  parentJobId: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** createdAt → startedAt of the last attempt (queue wait plus earlier attempts and backoff). */
  waitMs: number | null;
  /** startedAt → finishedAt of the last attempt. */
  runMs: number | null;
  error: { code: string; message: string } | null;
};

export type TraceAICall = {
  id: string;
  at: string | null;
  flowName: string;
  purpose: string | null;
  jobId: string | null;
  jobKind: string | null;
  model: string | null;
  status: string;
  latencyMs: number | null;
  attempts: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  prompt: string;
  response: string | null;
  error: string | null;
};

export type TraceTotals = {
  calls: number;
  failedCalls: number;
  /** Calls the provider's safety filter blocked ("Generation blocked"). A subset of failedCalls. */
  blockedCalls: number;
  modelMs: number;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
};

export type Trace = {
  book: { id: string; status: string; art: { total: number; done: number; failed: number }; styleId: string | null; createdAt: string | null; updatedAt: string | null } | null;
  story: { id: string; status: string; modeId: string | null; title: string | null; createdAt: string | null; completedAt: string | null } | null;
  manuscriptId: string | null;
  /** Wall time from the first job or call to the last. */
  spanMs: number | null;
  jobs: TraceJob[];
  jobCounts: Record<string, Record<string, number>>;
  aiCalls: TraceAICall[];
  totals: TraceTotals;
  totalsByPurpose: Record<string, TraceTotals>;
};
