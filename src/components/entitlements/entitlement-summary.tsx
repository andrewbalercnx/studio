'use client';

/**
 * Client surface for the entitlement roll-up (`GET /api/entitlements/summary`). Server-first: the
 * remaining counts are resolved on the server (child pool + family pool) so this only renders them.
 *
 * - `useEntitlementSummary(childId?)` — fetches the summary for the signed-in family (optionally a
 *   child scope). Re-fetches when `childId` changes or `refreshKey` bumps.
 * - `EntitlementSummaryCard` — parent-app card: "Stories left / Storybooks left" with a gentle
 *   at-limit hint.
 * - `StoriesLeftBadge` — compact "N stories left" pill for the kids create screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import type { EntitlementSummary } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, Sparkles } from 'lucide-react';

type SummaryState = {
  summary: EntitlementSummary | null;
  loading: boolean;
  error: boolean;
};

export function useEntitlementSummary(childId?: string, refreshKey?: unknown): SummaryState {
  const { user } = useUser();
  const [state, setState] = useState<SummaryState>({ summary: null, loading: true, error: false });

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setState({ summary: null, loading: false, error: false });
      return;
    }

    (async () => {
      setState((s) => ({ ...s, loading: true, error: false }));
      try {
        const token = await user.getIdToken();
        const qs = childId ? `?childId=${encodeURIComponent(childId)}` : '';
        const res = await fetch(`/api/entitlements/summary${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setState({ summary: null, loading: false, error: true });
          return;
        }
        setState({
          summary: { story: data.story, storybook: data.storybook },
          loading: false,
          error: false,
        });
      } catch {
        if (!cancelled) setState({ summary: null, loading: false, error: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, childId, refreshKey]);

  return state;
}

/** Parent-app card showing the family's remaining stories and storybooks. */
export function EntitlementSummaryCard({ className }: { className?: string }) {
  const { summary, loading, error } = useEntitlementSummary();

  // Stay quiet on error/while loading — this is supplementary info, never a blocker.
  if (loading || error || !summary) return null;

  const items: { label: string; remaining: number; icon: typeof Sparkles }[] = [
    { label: 'Stories', remaining: summary.story.remaining, icon: Sparkles },
    { label: 'Storybooks', remaining: summary.storybook.remaining, icon: BookOpen },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Your plan</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {items.map(({ label, remaining, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                <Icon className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{remaining}</p>
                <p className="text-sm text-muted-foreground">{label} left</p>
              </div>
            </div>
          ))}
        </div>
        {(summary.story.remaining === 0 || summary.storybook.remaining === 0) && (
          <p className="mt-4 text-sm text-muted-foreground">
            You&apos;ve used your free {summary.story.remaining === 0 ? 'stories' : 'storybooks'}.
            More plans are coming soon.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact "N stories left" pill for the kids create screen (child-scoped). */
export function StoriesLeftBadge({ childId }: { childId?: string }) {
  const { summary, loading, error } = useEntitlementSummary(childId);

  if (loading || error || !summary) return null;

  const remaining = summary.story.remaining;
  const out = remaining <= 0;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${
        out ? 'bg-amber-100 text-amber-800' : 'bg-amber-50 text-amber-700'
      }`}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {out ? 'No stories left' : `${remaining} ${remaining === 1 ? 'story' : 'stories'} left`}
    </span>
  );
}
