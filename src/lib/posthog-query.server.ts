/**
 * PostHog Query API client (server-only).
 *
 * The ops dashboard reads user-behaviour metrics (DAU/MAU, funnel) from PostHog's HogQL query
 * endpoint rather than scanning Firestore — Firestore is the operational store, PostHog is the
 * analytics store. This module is the only server-side touchpoint with PostHog.
 *
 * PostHog is currently DARK behind the compliance gate (`enableAnalytics` off, no DPA yet), so
 * the personal API key is typically absent. Every query helper therefore returns a discriminated
 * result: `{ available: false, reason: 'not_configured' }` when the key/project id are missing,
 * letting the dashboard render an honest "analytics not yet enabled" state per widget instead of
 * fake zeros.
 *
 * Results are cached in-memory per server instance (default 5 minutes) so dashboard refreshes
 * don't hammer the PostHog API or burn its rate limits.
 *
 * Env:
 *  - POSTHOG_PERSONAL_API_KEY  — personal API key with query:read scope (server secret, NOT the
 *    public NEXT_PUBLIC_POSTHOG_KEY used by the browser SDK)
 *  - POSTHOG_PROJECT_ID        — numeric PostHog project id
 *  - POSTHOG_API_HOST          — optional, defaults to the EU cloud
 */

import { ANALYTICS_EVENTS } from '@/lib/analytics/events';

const DEFAULT_API_HOST = 'https://eu.posthog.com';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const QUERY_TIMEOUT_MS = 15_000;

export type PostHogUnavailableReason = 'not_configured' | 'query_failed';

export type PostHogQueryResult<T> =
  | { available: true; data: T; cached: boolean }
  | { available: false; reason: PostHogUnavailableReason; message?: string };

export type ActiveUsersMetrics = {
  dau: number;
  wau: number;
  mau: number;
};

export type FunnelStep = {
  event: string;
  label: string;
  /** Unique users who performed the event in the window. */
  users: number;
  /** Drop-off vs the previous step, 0..1 (null for the first step). */
  dropOffFromPrevious: number | null;
};

type PostHogServerConfig = { apiKey: string; projectId: string; host: string };

function getServerConfig(): PostHogServerConfig | null {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    host: process.env.POSTHOG_API_HOST || DEFAULT_API_HOST,
  };
}

/** True when server-side PostHog querying is configured (key + project id present). */
export function isPostHogQueryConfigured(): boolean {
  return getServerConfig() !== null;
}

// ---------------------------------------------------------------------------
// Cached HogQL execution
// ---------------------------------------------------------------------------

type CacheEntry = { expiresAtMs: number; rows: unknown[][] };
const queryCache = new Map<string, CacheEntry>();

/** Test helper — clears the in-memory query cache. */
export function __resetPostHogQueryCacheForTest(): void {
  queryCache.clear();
}

async function runHogQL(config: PostHogServerConfig, query: string): Promise<unknown[][]> {
  const url = `${config.host}/api/projects/${config.projectId}/query/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PostHog query failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const json: any = await response.json();
    if (!Array.isArray(json?.results)) {
      throw new Error('PostHog query returned no results array');
    }
    return json.results as unknown[][];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a HogQL query with caching. Returns the result rows, with `cached: true` when served from
 * the in-memory cache. Throws when PostHog is unreachable or rejects the query.
 */
async function cachedHogQL(
  config: PostHogServerConfig,
  query: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): Promise<{ rows: unknown[][]; cached: boolean }> {
  const key = `${config.host}|${config.projectId}|${query}`;
  const now = Date.now();
  const hit = queryCache.get(key);
  if (hit && hit.expiresAtMs > now) {
    return { rows: hit.rows, cached: true };
  }
  const rows = await runHogQL(config, query);
  queryCache.set(key, { expiresAtMs: now + ttlMs, rows });
  return { rows, cached: false };
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Metric queries
// ---------------------------------------------------------------------------

/**
 * DAU / WAU / MAU — unique persons with any event in the last 1 / 7 / 30 days.
 * One query: conditional distinct counts over a 30-day scan.
 */
export async function getActiveUsers(): Promise<PostHogQueryResult<ActiveUsersMetrics>> {
  const config = getServerConfig();
  if (!config) return { available: false, reason: 'not_configured' };

  const query = `
    SELECT
      count(DISTINCT if(timestamp >= now() - INTERVAL 1 DAY, person_id, NULL)) AS dau,
      count(DISTINCT if(timestamp >= now() - INTERVAL 7 DAY, person_id, NULL)) AS wau,
      count(DISTINCT person_id) AS mau
    FROM events
    WHERE timestamp >= now() - INTERVAL 30 DAY
  `;

  try {
    const { rows, cached } = await cachedHogQL(config, query);
    const row = rows[0] ?? [];
    return {
      available: true,
      cached,
      data: { dau: toNumber(row[0]), wau: toNumber(row[1]), mau: toNumber(row[2]) },
    };
  } catch (error: any) {
    return { available: false, reason: 'query_failed', message: error?.message };
  }
}

/**
 * The Sprint-1 funnel, ordered. Labels are display copy for the ops dashboard.
 * Uses the audited analytics event taxonomy — single source of truth in src/lib/analytics/events.ts.
 */
export const FUNNEL_STEPS: ReadonlyArray<{ event: string; label: string }> = [
  { event: ANALYTICS_EVENTS.signupCompleted, label: 'Signed up' },
  { event: ANALYTICS_EVENTS.childCreated, label: 'Child profile created' },
  { event: ANALYTICS_EVENTS.storyStarted, label: 'Story started' },
  { event: ANALYTICS_EVENTS.storyCompleted, label: 'Story completed' },
  { event: ANALYTICS_EVENTS.storybookArtReady, label: 'Storybook art ready' },
  { event: ANALYTICS_EVENTS.checkoutStarted, label: 'Checkout started' },
  { event: ANALYTICS_EVENTS.printOrderPlaced, label: 'Print order placed' },
];

/**
 * Funnel with drop-off: unique users per funnel event over the last `days` days.
 * This is an "open funnel" (per-event unique users, not strictly-ordered sequences) — adequate
 * for spotting where users drop off without the cost of PostHog's full funnel analysis API.
 */
export async function getFunnel(days = 30): Promise<PostHogQueryResult<FunnelStep[]>> {
  const config = getServerConfig();
  if (!config) return { available: false, reason: 'not_configured' };

  const eventList = FUNNEL_STEPS.map((s) => `'${s.event}'`).join(', ');
  const query = `
    SELECT event, count(DISTINCT person_id) AS users
    FROM events
    WHERE event IN (${eventList})
      AND timestamp >= now() - INTERVAL ${Math.max(1, Math.floor(days))} DAY
    GROUP BY event
  `;

  try {
    const { rows, cached } = await cachedHogQL(config, query);
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(String(row[0]), toNumber(row[1]));
    }

    let previous: number | null = null;
    const steps: FunnelStep[] = FUNNEL_STEPS.map((step) => {
      const users = counts.get(step.event) ?? 0;
      const dropOffFromPrevious =
        previous === null ? null : previous > 0 ? Math.max(0, (previous - users) / previous) : null;
      previous = users;
      return { event: step.event, label: step.label, users, dropOffFromPrevious };
    });

    return { available: true, cached, data: steps };
  } catch (error: any) {
    return { available: false, reason: 'query_failed', message: error?.message };
  }
}
