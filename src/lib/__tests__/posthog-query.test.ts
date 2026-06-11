import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isPostHogQueryConfigured,
  getActiveUsers,
  getFunnel,
  FUNNEL_STEPS,
  __resetPostHogQueryCacheForTest,
} from '../posthog-query.server';

const ORIGINAL_ENV = { ...process.env };

function clearPostHogEnv() {
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  delete process.env.POSTHOG_PROJECT_ID;
  delete process.env.POSTHOG_API_HOST;
}

function setPostHogEnv() {
  process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_key';
  process.env.POSTHOG_PROJECT_ID = '12345';
  process.env.POSTHOG_API_HOST = 'https://eu.posthog.test';
}

describe('posthog-query.server', () => {
  beforeEach(() => {
    __resetPostHogQueryCacheForTest();
    clearPostHogEnv();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('gated behaviour when the API key is absent (compliance gate)', () => {
    it('reports not configured', () => {
      expect(isPostHogQueryConfigured()).toBe(false);
    });

    it('getActiveUsers returns an honest unavailable state without any network call', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await getActiveUsers();
      expect(result.available).toBe(false);
      if (!result.available) expect(result.reason).toBe('not_configured');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('getFunnel returns an honest unavailable state without any network call', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await getFunnel();
      expect(result.available).toBe(false);
      if (!result.available) expect(result.reason).toBe('not_configured');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('is unavailable when only one of key/project is set', async () => {
      process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_key';
      expect(isPostHogQueryConfigured()).toBe(false);
      const result = await getActiveUsers();
      expect(result.available).toBe(false);
    });
  });

  describe('configured behaviour', () => {
    beforeEach(setPostHogEnv);

    function mockFetchReturningRows(rows: unknown[][]) {
      const fetchSpy = vi.fn(async () =>
        new Response(JSON.stringify({ results: rows }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchSpy);
      return fetchSpy;
    }

    it('getActiveUsers parses DAU/WAU/MAU from the query result', async () => {
      const fetchSpy = mockFetchReturningRows([[3, 10, 42]]);
      const result = await getActiveUsers();
      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.data).toEqual({ dau: 3, wau: 10, mau: 42 });
        expect(result.cached).toBe(false);
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://eu.posthog.test/api/projects/12345/query/');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer phx_test_key');
    });

    it('caches repeated queries (single network call)', async () => {
      const fetchSpy = mockFetchReturningRows([[1, 2, 3]]);
      const first = await getActiveUsers();
      const second = await getActiveUsers();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(first.available && !first.cached).toBe(true);
      expect(second.available && second.cached).toBe(true);
    });

    it('getFunnel orders steps, fills missing events with 0, and computes drop-off', async () => {
      mockFetchReturningRows([
        ['signup.completed', 100],
        ['child.created', 80],
        ['story.started', 40],
        // story.completed missing → 0
        ['storybook.art_ready', 0],
        ['checkout.started', 0],
        ['print_order.placed', 0],
      ]);

      const result = await getFunnel(30);
      expect(result.available).toBe(true);
      if (!result.available) return;

      expect(result.data.map((s) => s.event)).toEqual(FUNNEL_STEPS.map((s) => s.event));
      const [signup, child, started, completed] = result.data;
      expect(signup.users).toBe(100);
      expect(signup.dropOffFromPrevious).toBeNull();
      expect(child.dropOffFromPrevious).toBeCloseTo(0.2);
      expect(started.dropOffFromPrevious).toBeCloseTo(0.5);
      expect(completed.users).toBe(0);
      expect(completed.dropOffFromPrevious).toBeCloseTo(1);
    });

    it('returns query_failed (not a throw) when PostHog rejects the query', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('forbidden', { status: 403 }))
      );
      const result = await getActiveUsers();
      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toBe('query_failed');
        expect(result.message).toContain('403');
      }
    });
  });
});
