/**
 * One Book's or Story's whole run as a timeline, for /admin/trace and
 * GET /api/admin/trace: the jobs (queue wait, run time, attempts, errors) and
 * every AI call (model, latency, tokens, prompt, response), with totals.
 *
 * AI calls are found by the ids the harness tags them with (trace-context.ts):
 * calls logged before that tagging existed do not appear.
 */
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { NotFoundError } from '../errors';
import type { TraceQuery, TraceJob, TraceAICall, TraceTotals, Trace } from '@/lib/diagnostics/trace-types';

export type { TraceQuery, TraceJob, TraceAICall, TraceTotals, Trace };

const PROMPT_LIMIT = 4000;

function millis(value: unknown): number | null {
  return value && typeof (value as { toMillis?: unknown }).toMillis === 'function' ? (value as { toMillis(): number }).toMillis() : null;
}

function iso(value: unknown): string | null {
  const ms = millis(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function emptyTotals(): TraceTotals {
  return { calls: 0, failedCalls: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, thoughtsTokens: 0 };
}

function add(totals: TraceTotals, call: TraceAICall): void {
  totals.calls += 1;
  if (call.status !== 'success') totals.failedCalls += 1;
  totals.modelMs += call.latencyMs ?? 0;
  totals.inputTokens += call.inputTokens ?? 0;
  totals.outputTokens += call.outputTokens ?? 0;
  totals.thoughtsTokens += call.thoughtsTokens ?? 0;
}

function toJob(data: DocumentData): TraceJob {
  const created = millis(data.createdAt);
  const started = millis(data.startedAt);
  const finished = millis(data.finishedAt);
  const target = data.target ?? {};
  return {
    jobId: data.jobId,
    kind: data.kind,
    target: [target.collection, target.id, target.subpath].filter(Boolean).join('/'),
    status: data.status,
    attempt: data.attempt ?? 0,
    maxAttempts: data.maxAttempts ?? 0,
    parentJobId: data.parentJobId ?? null,
    createdAt: iso(data.createdAt),
    startedAt: iso(data.startedAt),
    finishedAt: iso(data.finishedAt),
    waitMs: created !== null && started !== null ? started - created : null,
    runMs: started !== null && finished !== null ? finished - started : null,
    error: data.error ? { code: String(data.error.code), message: String(data.error.message) } : null,
  };
}

function toCall(id: string, data: DocumentData): TraceAICall {
  const usage = data.usage ?? {};
  return {
    id,
    at: iso(data.createdAt),
    flowName: data.flowName ?? '',
    purpose: data.purpose ?? null,
    jobId: data.jobId ?? null,
    jobKind: data.jobKind ?? null,
    model: data.modelName ?? null,
    status: data.status ?? 'unknown',
    latencyMs: num(data.latencyMs),
    attempts: num(data.attemptNumber),
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    thoughtsTokens: num(usage.thoughtsTokens),
    prompt: typeof data.prompt === 'string' ? data.prompt.slice(0, PROMPT_LIMIT) : '',
    response: data.response?.text ?? null,
    error: data.errorMessage ?? data.failureReason ?? null,
  };
}

export async function buildTrace(db: Firestore, query: TraceQuery): Promise<Trace> {
  let bookData: DocumentData | null = null;
  let storyId = query.storyId ?? null;
  if (query.bookId) {
    const snap = await db.doc(`books/${query.bookId}`).get();
    if (!snap.exists) throw new NotFoundError(`No book ${query.bookId}`, { code: 'BOOK_NOT_FOUND' });
    bookData = { id: snap.id, ...snap.data() };
    storyId = bookData.storyId ?? storyId;
  }
  const storySnap = storyId ? await db.doc(`stories/${storyId}`).get() : null;
  if (!bookData && !storySnap?.exists) throw new NotFoundError(`No story ${storyId}`, { code: 'STORY_NOT_FOUND' });
  const storyData = storySnap?.exists ? storySnap.data()! : null;
  const manuscriptId: string | null = bookData?.manuscriptId ?? null;

  // A Book's trace is its own work plus the Story and Manuscript it came from.
  const ids = [query.bookId, manuscriptId, storyId].filter((id): id is string => !!id);
  const jobSnap = await db.collection('jobs').where('target.id', 'in', ids).get();
  const jobs = jobSnap.docs.map((d) => toJob(d.data())).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  const callSnaps = await Promise.all([
    query.bookId ? db.collection('aiFlowLogs').where('bookId', '==', query.bookId).get() : null,
    manuscriptId ? db.collection('aiFlowLogs').where('manuscriptId', '==', manuscriptId).get() : null,
    storyId ? db.collection('aiFlowLogs').where('storyId', '==', storyId).get() : null,
  ]);
  const seen = new Set<string>();
  const aiCalls: TraceAICall[] = [];
  for (const snap of callSnaps) {
    for (const doc of snap?.docs ?? []) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      aiCalls.push(toCall(doc.id, doc.data()));
    }
  }
  aiCalls.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));

  const totals = emptyTotals();
  const totalsByPurpose: Record<string, TraceTotals> = {};
  for (const call of aiCalls) {
    add(totals, call);
    add((totalsByPurpose[call.purpose ?? call.flowName] ??= emptyTotals()), call);
  }
  const jobCounts: Record<string, Record<string, number>> = {};
  for (const job of jobs) {
    const counts = (jobCounts[job.kind] ??= {});
    counts[job.status] = (counts[job.status] ?? 0) + 1;
  }

  const times = [
    ...jobs.flatMap((j) => [j.createdAt, j.finishedAt]),
    ...aiCalls.map((c) => c.at),
  ]
    .filter((t): t is string => !!t)
    .map((t) => Date.parse(t));
  const spanMs = times.length ? Math.max(...times) - Math.min(...times) : null;

  return {
    book: bookData
      ? {
          id: bookData.id,
          status: bookData.status,
          art: { total: bookData.art?.total ?? 0, done: bookData.art?.done ?? 0, failed: bookData.art?.failed ?? 0 },
          styleId: bookData.styleId ?? null,
          createdAt: iso(bookData.createdAt),
          updatedAt: iso(bookData.updatedAt),
        }
      : null,
    story: storyData
      ? {
          id: storyId!,
          status: storyData.status,
          modeId: storyData.modeId ?? null,
          title: storyData.title ?? null,
          createdAt: iso(storyData.createdAt),
          completedAt: iso(storyData.completedAt),
        }
      : null,
    manuscriptId,
    spanMs,
    jobs,
    jobCounts,
    aiCalls,
    totals,
    totalsByPurpose,
  };
}
