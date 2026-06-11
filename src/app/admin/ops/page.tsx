'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@/firebase/auth/use-user';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoaderCircle, RefreshCw, Activity, Users, Printer, AlertTriangle, HeartPulse } from 'lucide-react';

// --- Response shapes from /api/admin/ops/metrics ---

type PostHogResult<T> =
  | { available: true; data: T; cached: boolean }
  | { available: false; reason: 'not_configured' | 'query_failed'; message?: string };

type FunnelStep = {
  event: string;
  label: string;
  users: number;
  dropOffFromPrevious: number | null;
};

type OpsMetrics = {
  ok: boolean;
  generatedAt: string;
  analytics: {
    activeUsers: PostHogResult<{ dau: number; wau: number; mau: number }>;
    funnel: PostHogResult<FunnelStep[]>;
  };
  generation: {
    windowHours: number;
    total: number;
    errors: number;
    errorRate: number;
    topErrorFlows: Array<{ flowName: string; count: number; lastMessage: string }>;
  };
  printOrders: {
    windowDays: number;
    placed: number;
    paid: number;
    submittedOrBeyond: number;
    shippedOrDelivered: number;
    needingAttention: number;
    unreviewedOver24h: number;
    byStatus: Record<string, number>;
    conversion: { placedToSubmitted: number | null; placedToShipped: number | null };
  };
  health: {
    lastRunAtMs: number | null;
    results: Array<{ id: string; breached: boolean; summary: string }>;
    thresholds: Record<string, number> | null;
  } | null;
};

function AnalyticsUnavailable({ result }: { result: { reason: string; message?: string } }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      {result.reason === 'not_configured' ? (
        <>
          <p className="font-medium">Analytics not yet enabled</p>
          <p className="text-xs mt-1">
            PostHog is dark behind the compliance gate (no DPA/consent yet). Once enabled, set
            POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID and this widget lights up — no code
            changes needed.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">Analytics query failed</p>
          {result.message && <p className="text-xs mt-1 font-mono">{result.message}</p>}
        </>
      )}
    </div>
  );
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return `${Math.round(value * 100)}%`;
}

export default function OpsDashboardPage() {
  const { user, loading: userLoading } = useUser();
  const { isAdmin, loading: authLoading } = useAdminStatus();
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin/ops/metrics', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) {
        throw new Error(data.errorMessage || 'Failed to load metrics');
      }
      setMetrics(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!userLoading && user) loadMetrics();
  }, [user, userLoading, loadMetrics]);

  const runHealthChecks = async () => {
    if (!user) return;
    try {
      setRunningChecks(true);
      setCheckMessage(null);
      const idToken = await user.getIdToken();
      const response = await fetch('/api/admin/ops/health-check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true) {
        throw new Error(data.errorMessage || 'Health check failed');
      }
      setCheckMessage(
        data.healthy
          ? 'All checks healthy.'
          : `Breaches detected${data.alertsSent.length > 0 ? ` — alert sent for: ${data.alertsSent.join(', ')}` : ' (alert suppressed by cooldown)'}`
      );
      await loadMetrics();
    } catch (e: any) {
      setCheckMessage(`Error: ${e.message}`);
    } finally {
      setRunningChecks(false);
    }
  };

  if (authLoading || userLoading) {
    return (
      <div className="container mx-auto p-8 flex items-center gap-2">
        <LoaderCircle className="h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (!user) {
    return <div className="container mx-auto p-8">You must be signed in to access this page.</div>;
  }
  if (!isAdmin) {
    return <div className="container mx-auto p-8">This page is admin-only.</div>;
  }

  const generationHealthy = metrics ? metrics.generation.errorRate <= 0.1 : true;

  return (
    <div className="container mx-auto p-4 sm:p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-7 w-7" /> Ops Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Where are users dropping off, and what&apos;s broken right now?
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadMetrics} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">Back to Admin</Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading && !metrics ? (
        <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
          <LoaderCircle className="h-5 w-5 animate-spin" /> Loading metrics…
        </div>
      ) : metrics ? (
        <>
          {/* Row 1: user behaviour (PostHog) */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" /> Active Users
                </CardTitle>
                <CardDescription>Unique users with any event (PostHog)</CardDescription>
              </CardHeader>
              <CardContent>
                {metrics.analytics.activeUsers.available ? (
                  <div className="grid grid-cols-3 gap-4 text-center">
                    {(['dau', 'wau', 'mau'] as const).map((k) => (
                      <div key={k} className="rounded-lg border p-4">
                        <p className="text-3xl font-bold">{metrics.analytics.activeUsers.available && metrics.analytics.activeUsers.data[k]}</p>
                        <p className="text-xs text-muted-foreground uppercase mt-1">{k}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <AnalyticsUnavailable result={metrics.analytics.activeUsers} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="h-5 w-5" /> Funnel — last 30 days
                </CardTitle>
                <CardDescription>Unique users per step, with drop-off (PostHog)</CardDescription>
              </CardHeader>
              <CardContent>
                {metrics.analytics.funnel.available ? (
                  <div className="space-y-2">
                    {metrics.analytics.funnel.data.map((step, i) => {
                      const max = metrics.analytics.funnel.available
                        ? Math.max(1, ...metrics.analytics.funnel.data.map((s) => s.users))
                        : 1;
                      const highDropOff = (step.dropOffFromPrevious ?? 0) >= 0.5;
                      return (
                        <div key={step.event} className="flex items-center gap-2 text-sm">
                          <span className="w-44 shrink-0 truncate" title={step.event}>
                            {i + 1}. {step.label}
                          </span>
                          <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                            <div
                              className="bg-blue-500 h-5 rounded"
                              style={{ width: `${Math.max(2, (step.users / max) * 100)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right font-mono">{step.users}</span>
                          <span
                            className={`w-20 text-right text-xs ${highDropOff ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}
                          >
                            {step.dropOffFromPrevious === null ? '' : `−${pct(step.dropOffFromPrevious)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <AnalyticsUnavailable result={metrics.analytics.funnel} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 2: operational metrics (Firestore) */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5" /> Generation Errors — last {metrics.generation.windowHours}h
                </CardTitle>
                <CardDescription>From aiFlowLogs (operational store)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="rounded-lg border p-4">
                    <p className="text-3xl font-bold">{metrics.generation.total}</p>
                    <p className="text-xs text-muted-foreground mt-1">Flow runs</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-3xl font-bold">{metrics.generation.errors}</p>
                    <p className="text-xs text-muted-foreground mt-1">Errors</p>
                  </div>
                  <div className={`rounded-lg border p-4 ${generationHealthy ? '' : 'border-red-300 bg-red-50'}`}>
                    <p className={`text-3xl font-bold ${generationHealthy ? '' : 'text-red-700'}`}>
                      {pct(metrics.generation.errorRate)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Error rate</p>
                  </div>
                </div>
                {metrics.generation.topErrorFlows.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">Top failing flows</p>
                    <ul className="text-xs space-y-1">
                      {metrics.generation.topErrorFlows.map((f) => (
                        <li key={f.flowName} className="flex gap-2">
                          <span className="font-mono shrink-0">{f.flowName} ×{f.count}</span>
                          <span className="text-muted-foreground truncate" title={f.lastMessage}>
                            {f.lastMessage}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Printer className="h-5 w-5" /> Print Orders — last {metrics.printOrders.windowDays} days
                </CardTitle>
                <CardDescription>
                  Pipeline and conversion from printOrders (operational store) —{' '}
                  <Link href="/admin/print-orders" className="underline">
                    manage orders
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold">{metrics.printOrders.placed}</p>
                    <p className="text-xs text-muted-foreground mt-1">Placed</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold">{metrics.printOrders.paid}</p>
                    <p className="text-xs text-muted-foreground mt-1">Paid</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold">{metrics.printOrders.submittedOrBeyond}</p>
                    <p className="text-xs text-muted-foreground mt-1">Submitted+</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold">{metrics.printOrders.shippedOrDelivered}</p>
                    <p className="text-xs text-muted-foreground mt-1">Shipped+</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>
                    Conversion placed → submitted:{' '}
                    <strong>{pct(metrics.printOrders.conversion.placedToSubmitted)}</strong>
                  </span>
                  <span>
                    placed → shipped: <strong>{pct(metrics.printOrders.conversion.placedToShipped)}</strong>
                  </span>
                </div>
                {(metrics.printOrders.needingAttention > 0 || metrics.printOrders.unreviewedOver24h > 0) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {metrics.printOrders.needingAttention} order(s) need admin attention
                    {metrics.printOrders.unreviewedOver24h > 0 && (
                      <> — <strong>{metrics.printOrders.unreviewedOver24h} un-reviewed for &gt; 24h</strong></>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 3: health checks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <HeartPulse className="h-5 w-5" /> Health Checks
                  </CardTitle>
                  <CardDescription>
                    Stuck art, un-reviewed orders, error-rate spikes — thresholds in systemConfig/opsHealth.
                    Breaches alert maintenance users (deduped by cooldown).
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={runHealthChecks} disabled={runningChecks}>
                  {runningChecks ? (
                    <>
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Running…
                    </>
                  ) : (
                    'Run checks now'
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {checkMessage && <p className="text-sm">{checkMessage}</p>}
              {metrics.health ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Last run:{' '}
                    {metrics.health.lastRunAtMs ? new Date(metrics.health.lastRunAtMs).toLocaleString() : 'never'}
                  </p>
                  <ul className="space-y-2">
                    {metrics.health.results.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-sm">
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${r.breached ? 'bg-red-500' : 'bg-green-500'}`}
                        />
                        <span className="font-mono text-xs w-40 shrink-0">{r.id}</span>
                        <span className={r.breached ? 'text-red-700' : 'text-muted-foreground'}>{r.summary}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No health-check run recorded yet — click &quot;Run checks now&quot;.
                </p>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">Generated {new Date(metrics.generatedAt).toLocaleString()}</p>
        </>
      ) : null}
    </div>
  );
}
