'use client';

/**
 * Admin: one Book's or Story's run as a timeline (GET /api/admin/trace).
 * Open with ?bookId=bk_… or ?storyId=st_…, or paste an id or a Book/Story URL.
 */
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { authFetch } from '@/lib/auth-fetch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Trace, TraceAICall, TraceTotals } from '@/lib/diagnostics/trace-types';

type TraceTarget = { bookId?: string; storyId?: string };

/** Accepts `bk_…`, `st_…`, or a URL containing one. */
function parseTarget(text: string): TraceTarget | null {
  const book = /\b(bk_[A-Za-z0-9]+)/.exec(text)?.[1];
  if (book) return { bookId: book };
  const story = /\b(st_[A-Za-z0-9]+)/.exec(text)?.[1];
  if (story) return { storyId: story };
  return null;
}

function seconds(ms: number | null): string {
  return ms === null ? '–' : `${(ms / 1000).toFixed(1)}s`;
}

function time(isoString: string | null): string {
  return isoString ? new Date(isoString).toLocaleTimeString() : '–';
}

function tokens(n: number | null): string {
  return n === null ? '–' : n.toLocaleString();
}

const STATUS_TONE: Record<string, string> = {
  succeeded: 'bg-green-100 text-green-800',
  success: 'bg-green-100 text-green-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  failure: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-700',
};

function Status({ value }: { value: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TONE[value] ?? 'bg-gray-100 text-gray-700'}`}>{value}</span>;
}

function TotalsRow({ label, totals }: { label: string; totals: TraceTotals }) {
  return (
    <tr className="border-t">
      <td className="py-1 pr-4 font-mono text-xs">{label}</td>
      <td className="py-1 pr-4 text-right">{totals.calls}</td>
      <td className="py-1 pr-4 text-right">{totals.failedCalls}</td>
      <td className={`py-1 pr-4 text-right ${totals.blockedCalls ? 'text-red-700 font-medium' : ''}`}>{totals.blockedCalls}</td>
      <td className="py-1 pr-4 text-right">{seconds(totals.modelMs)}</td>
      <td className="py-1 pr-4 text-right">{tokens(totals.inputTokens)}</td>
      <td className="py-1 pr-4 text-right">{tokens(totals.outputTokens)}</td>
      <td className="py-1 pr-4 text-right">{tokens(totals.thoughtsTokens)}</td>
    </tr>
  );
}

function CallRow({ call }: { call: TraceAICall }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t cursor-pointer hover:bg-muted/50" onClick={() => setOpen((v) => !v)}>
        <td className="py-1 pr-3 whitespace-nowrap">{time(call.at)}</td>
        <td className="py-1 pr-3 font-mono text-xs">{call.purpose ?? call.flowName}</td>
        <td className="py-1 pr-3 font-mono text-xs">{call.model ?? '–'}</td>
        <td className="py-1 pr-3"><Status value={call.status} /></td>
        <td className="py-1 pr-3 text-right">{seconds(call.latencyMs)}</td>
        <td className="py-1 pr-3 text-right">{call.attempts ?? '–'}</td>
        <td className="py-1 pr-3 text-right">{tokens(call.inputTokens)}</td>
        <td className="py-1 pr-3 text-right">{tokens(call.outputTokens)}</td>
        <td className="py-1 pr-3 text-right">{tokens(call.thoughtsTokens)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="bg-muted/30 p-3 text-xs space-y-2">
            <div className="text-muted-foreground">
              {call.flowName}
              {call.jobKind ? ` · job ${call.jobKind} ${call.jobId}` : ''}
            </div>
            {call.error && <div className="text-red-700">Error: {call.error}</div>}
            <div>
              <div className="font-semibold">Prompt</div>
              <pre className="whitespace-pre-wrap break-words max-h-80 overflow-auto">{call.prompt || '–'}</pre>
            </div>
            <div>
              <div className="font-semibold">Response (first 500 characters)</div>
              <pre className="whitespace-pre-wrap break-words max-h-60 overflow-auto">{call.response ?? '–'}</pre>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminTracePage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const [input, setInput] = useState('');
  const [target, setTarget] = useState<TraceTarget | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);

  // ?bookId= / ?storyId= on first load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('bookId') ? { bookId: params.get('bookId')! } : params.get('storyId') ? { storyId: params.get('storyId')! } : null;
    if (initial) {
      setInput(initial.bookId ?? initial.storyId ?? '');
      setTarget(initial);
    }
  }, []);

  const load = useCallback(async (t: TraceTarget) => {
    setLoading(true);
    try {
      const query = t.bookId ? `bookId=${encodeURIComponent(t.bookId)}` : `storyId=${encodeURIComponent(t.storyId!)}`;
      const response = await authFetch(`/api/admin/trace?${query}`);
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
      setTrace(body.data as Trace);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!target || !isAdmin) return;
    void load(target);
    if (!live) return;
    const timer = setInterval(() => void load(target), 5000);
    return () => clearInterval(timer);
  }, [target, isAdmin, live, load]);

  const submit = () => {
    const parsed = parseTarget(input);
    if (!parsed) {
      setError('Paste a book id (bk_…), a story id (st_…), or a Book/Story URL.');
      return;
    }
    setTrace(null);
    setTarget(parsed);
    window.history.replaceState(null, '', `/admin/trace?${parsed.bookId ? `bookId=${parsed.bookId}` : `storyId=${parsed.storyId}`}`);
  };

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 p-6">
        <LoaderCircle className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (!isAuthenticated || !isAdmin) return <p className="p-6">You must be an admin to view this page.</p>;

  return (
    <div className="container mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Book &amp; Story trace</CardTitle>
          <CardDescription>
            Every job and AI call for one Book or Story: timings, attempts, errors, models, tokens, prompts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <Input
            className="max-w-xl"
            placeholder="bk_… or st_… or a Book/Story URL"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Button onClick={submit}>Trace</Button>
          <Button variant="outline" onClick={() => setLive((v) => !v)} title="Refresh every 5 seconds">
            <RefreshCw className={`h-4 w-4 mr-1 ${live && loading ? 'animate-spin' : ''}`} />
            {live ? 'Live' : 'Paused'}
          </Button>
          {error && <span className="text-sm text-red-700">{error}</span>}
        </CardContent>
      </Card>

      {trace && (
        <>
          <Card>
            <CardContent className="pt-6 text-sm space-y-1">
              {trace.book && (
                <div>
                  <b>Book</b> {trace.book.id} <Status value={trace.book.status} /> art {trace.book.art.done}/{trace.book.art.total} done
                  {trace.book.art.failed ? `, ${trace.book.art.failed} failed` : ''} · style {trace.book.styleId ?? '–'} · created {time(trace.book.createdAt)} · updated{' '}
                  {time(trace.book.updatedAt)}
                </div>
              )}
              {trace.story && (
                <div>
                  <b>Story</b> {trace.story.id} <Status value={trace.story.status} /> {trace.story.title ? `“${trace.story.title}”` : ''} · mode{' '}
                  {trace.story.modeId ?? '–'} · created {time(trace.story.createdAt)} · completed {time(trace.story.completedAt)}
                </div>
              )}
              {trace.manuscriptId && <div><b>Manuscript</b> {trace.manuscriptId}</div>}
              <div>
                <b>Span</b> {seconds(trace.spanMs)} · <b>{trace.totals.calls}</b> AI calls ({trace.totals.failedCalls} failed
                {trace.totals.blockedCalls ? `, ${trace.totals.blockedCalls} blocked by safety filter` : ''}),{' '}
                {seconds(trace.totals.modelMs)} model time, {tokens(trace.totals.inputTokens)} in / {tokens(trace.totals.outputTokens)} out /{' '}
                {tokens(trace.totals.thoughtsTokens)} thinking tokens
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI calls by purpose</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pr-4">Purpose</th>
                    <th className="pr-4 text-right">Calls</th>
                    <th className="pr-4 text-right">Failed</th>
                    <th className="pr-4 text-right">Blocked</th>
                    <th className="pr-4 text-right">Model time</th>
                    <th className="pr-4 text-right">In</th>
                    <th className="pr-4 text-right">Out</th>
                    <th className="pr-4 text-right">Thinking</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(trace.totalsByPurpose).map(([purpose, totals]) => (
                    <TotalsRow key={purpose} label={purpose} totals={totals} />
                  ))}
                  <TotalsRow label="total" totals={trace.totals} />
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Jobs ({trace.jobs.length})</CardTitle>
              <CardDescription className="flex flex-wrap gap-2">
                {Object.entries(trace.jobCounts).map(([kind, counts]) => (
                  <Badge key={kind} variant="outline" className="font-mono">
                    {kind}: {Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')}
                  </Badge>
                ))}
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pr-3">Created</th>
                    <th className="pr-3">Kind</th>
                    <th className="pr-3">Target</th>
                    <th className="pr-3">Status</th>
                    <th className="pr-3 text-right">Attempt</th>
                    <th className="pr-3 text-right">Wait</th>
                    <th className="pr-3 text-right">Run</th>
                    <th className="pr-3">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.jobs.map((job) => (
                    <tr key={job.jobId} className="border-t align-top">
                      <td className="py-1 pr-3 whitespace-nowrap">{time(job.createdAt)}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{job.kind}</td>
                      <td className="py-1 pr-3 font-mono text-xs">{job.target}</td>
                      <td className="py-1 pr-3"><Status value={job.status} /></td>
                      <td className="py-1 pr-3 text-right">{job.attempt}/{job.maxAttempts}</td>
                      <td className="py-1 pr-3 text-right">{seconds(job.waitMs)}</td>
                      <td className="py-1 pr-3 text-right">{seconds(job.runMs)}</td>
                      <td className="py-1 pr-3 text-xs text-red-700">{job.error ? `${job.error.code}: ${job.error.message}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI calls ({trace.aiCalls.length})</CardTitle>
              <CardDescription>Click a row for its prompt and response.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="pr-3">At</th>
                    <th className="pr-3">Purpose</th>
                    <th className="pr-3">Model</th>
                    <th className="pr-3">Status</th>
                    <th className="pr-3 text-right">Latency</th>
                    <th className="pr-3 text-right">Attempts</th>
                    <th className="pr-3 text-right">In</th>
                    <th className="pr-3 text-right">Out</th>
                    <th className="pr-3 text-right">Thinking</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.aiCalls.map((call) => (
                    <CallRow key={call.id} call={call} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
