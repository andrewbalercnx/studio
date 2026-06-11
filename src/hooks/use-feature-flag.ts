'use client';

/**
 * useFeatureFlag — client-side read of server-evaluated feature flags.
 *
 * Calls GET /api/flags (with the user's ID token when signed in, so
 * uid/email/percentage Remote Config conditions apply) and returns the flag
 * value. While loading — and if the fetch fails — the in-code default from
 * FLAG_DEFAULTS is returned, so a flag read can never blank out UI.
 *
 * One fetch per (uid, ~30s window) is shared across all hook instances via a
 * module-level cache; this is a flag read, not a realtime subscription —
 * users pick up flag changes on next fetch window or reload.
 */

import { useEffect, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { FLAG_DEFAULTS, type FeatureFlagKey } from '@/lib/feature-flags';

const CACHE_TTL_MS = 30_000;

type FlagMap = Partial<Record<string, boolean>>;

let cache: { key: string; fetchedAtMs: number; promise: Promise<FlagMap> } | null = null;

async function fetchFlags(token: string | null): Promise<FlagMap> {
  const response = await fetch('/api/flags', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`flags fetch failed: ${response.status}`);
  const body = (await response.json()) as { ok?: boolean; flags?: FlagMap };
  if (!body.ok || !body.flags) throw new Error('flags fetch returned malformed body');
  return body.flags;
}

function getSharedFlags(uid: string | null, token: string | null): Promise<FlagMap> {
  const cacheKey = uid ?? 'anonymous';
  const now = Date.now();
  if (cache && cache.key === cacheKey && now - cache.fetchedAtMs <= CACHE_TTL_MS) {
    return cache.promise;
  }
  const promise = fetchFlags(token).catch((error) => {
    console.warn('[useFeatureFlag] fetch failed; using defaults:', error);
    cache = null; // allow retry on next read
    return {} as FlagMap;
  });
  cache = { key: cacheKey, fetchedAtMs: now, promise };
  return promise;
}

export type UseFeatureFlagResult = {
  /** Resolved value (in-code default until loaded). */
  enabled: boolean;
  /** True until the server-evaluated value has arrived. */
  loading: boolean;
};

export function useFeatureFlag(key: FeatureFlagKey): UseFeatureFlagResult {
  const { user, loading: authLoading } = useUser();
  const [state, setState] = useState<UseFeatureFlagResult>({
    enabled: FLAG_DEFAULTS[key],
    loading: true,
  });

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      let token: string | null = null;
      try {
        token = (await user?.getIdToken?.()) ?? null;
      } catch {
        // Evaluate anonymously if the token is unavailable.
      }
      const flags = await getSharedFlags(user?.uid ?? null, token);
      if (cancelled) return;
      setState({ enabled: flags[key] ?? FLAG_DEFAULTS[key], loading: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [key, user, authLoading]);

  return state;
}
