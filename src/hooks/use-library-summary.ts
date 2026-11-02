'use client';

/**
 * Story and Book counts for the signed-in family, in total and per child
 * (GET /api/library/summary). Counted on the server, the way the lists show them.
 */
import { useEffect, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { authFetch } from '@/lib/auth-fetch';
import type { LibraryCounts, LibrarySummary } from '@/lib/library/types';

const ZERO: LibraryCounts = { stories: 0, books: 0 };

export function useLibrarySummary() {
  const { user } = useUser();
  const [summary, setSummary] = useState<LibrarySummary | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    authFetch('/api/library/summary', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled && body?.ok) setSummary(body.data as LibrarySummary);
      })
      .catch(() => undefined); // counts are supplementary; the lists still work without them
    return () => {
      cancelled = true;
    };
  }, [user]);

  return {
    summary,
    /** Counts for one child (zeros until loaded or when the child has nothing yet). */
    forChild: (childId: string): LibraryCounts => summary?.byChild[childId] ?? ZERO,
  };
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
