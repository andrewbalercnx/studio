'use client';

/**
 * Admin: a family's allowances (GET/POST /api/admin/allowances). Find a family
 * by email, see the family pool and each child's own balances, adjust one with
 * a reason. Every change is kept in the family's grant history.
 */
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { authFetch } from '@/lib/auth-fetch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { AllowanceAdjustment, AllowanceRow, FamilyAllowances } from '@/lib/entitlements/admin-types';

async function call(path: string, init?: RequestInit): Promise<FamilyAllowances> {
  const response = await authFetch(path, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body.data as FamilyAllowances;
}

function AdjustForm({ row, onApply }: { row: AllowanceRow; onApply: (mode: AllowanceAdjustment['mode'], quantity: number, reason: string) => Promise<void> }) {
  const [mode, setMode] = useState<AllowanceAdjustment['mode']>('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(quantity);
  const valid = quantity !== '' && Number.isInteger(n) && reason.trim().length >= 3 && (mode === 'add' ? n !== 0 : n >= 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="h-9 rounded-md border bg-background px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as AllowanceAdjustment['mode'])}>
        <option value="add">Add (or −)</option>
        <option value="setRemaining">Set left to</option>
      </select>
      <Input className="h-9 w-20" inputMode="numeric" placeholder={mode === 'add' ? '+5' : '10'} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <Input className="h-9 w-48" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button
        size="sm"
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onApply(mode, n, reason.trim());
            setQuantity('');
            setReason('');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : 'Apply'}
      </Button>
      <span className="text-xs text-muted-foreground">
        {valid && (mode === 'add' ? `→ ${Math.max(0, row.remaining + n)} left` : `→ ${n} left`)}
      </span>
    </div>
  );
}

function BalanceTable({ rows, onApply }: { rows: AllowanceRow[]; onApply: (row: AllowanceRow, mode: AllowanceAdjustment['mode'], quantity: number, reason: string) => Promise<void> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="pr-3 py-1">Allowance</th>
            <th className="pr-3 py-1 text-right">Left</th>
            <th className="pr-3 py-1 text-right">Used</th>
            <th className="pr-3 py-1 text-right">Total</th>
            <th className="py-1">Adjust</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component} className="border-t align-middle">
              <td className="pr-3 py-2">
                {r.label}
                {r.reset && <span className="ml-1 text-xs text-muted-foreground">({r.reset})</span>}
              </td>
              <td className="pr-3 py-2 text-right text-lg font-bold">{r.remaining}</td>
              <td className="pr-3 py-2 text-right">{r.used}</td>
              <td className="pr-3 py-2 text-right">{r.total}</td>
              <td className="py-2">
                <AdjustForm row={r} onApply={(mode, q, reason) => onApply(r, mode, q, reason)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminAllowancesPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<FamilyAllowances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const find = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setFamily(await call(`/api/admin/allowances?q=${encodeURIComponent(q.trim())}`));
      window.history.replaceState(null, '', `/admin/allowances?q=${encodeURIComponent(q.trim())}`);
    } catch (err) {
      setFamily(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q && isAdmin) {
      setQuery(q);
      void find(q);
    }
  }, [isAdmin, find]);

  const apply = (childId?: string) => async (row: AllowanceRow, mode: AllowanceAdjustment['mode'], quantity: number, reason: string) => {
    if (!family) return;
    setError(null);
    try {
      const body: AllowanceAdjustment = { uid: family.uid, ...(childId ? { childId } : {}), component: row.component, mode, quantity, reason };
      setFamily(await call('/api/admin/allowances', { method: 'POST', body: JSON.stringify(body) }));
    } catch (err) {
      setError((err as Error).message);
    }
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
          <CardTitle>Allowances</CardTitle>
          <CardDescription>
            Find a family by email (or uid) and adjust what they can still make. A child&apos;s own allowance is used before the family pool. Every change is
            recorded with your name and the reason.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input className="max-w-md" placeholder="parent@example.com" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find(query)} />
          <Button onClick={() => find(query)} disabled={loading}>
            {loading ? 'Finding…' : 'Find'}
          </Button>
          {error && <span className="text-sm text-red-700">{error}</span>}
        </CardContent>
      </Card>

      {family && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Family pool · {family.email ?? family.uid}</CardTitle>
              {!family.ledgerExists && <CardDescription>This family has not made anything yet; these are the free-tier balances it starts with.</CardDescription>}
            </CardHeader>
            <CardContent>
              <BalanceTable rows={family.family} onApply={apply()} />
            </CardContent>
          </Card>

          {family.children.map((child) => (
            <Card key={child.childId}>
              <CardHeader>
                <CardTitle className="text-base">{child.displayName}&apos;s own allowance</CardTitle>
                <CardDescription>Used first; when it runs out, {child.displayName} draws on the family pool.</CardDescription>
              </CardHeader>
              <CardContent>
                <BalanceTable rows={child.rows} onApply={apply(child.childId)} />
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History ({family.history.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {family.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="pr-3">When</th>
                      <th className="pr-3">Who</th>
                      <th className="pr-3">Scope</th>
                      <th className="pr-3">Allowance</th>
                      <th className="pr-3 text-right">Left</th>
                      <th className="pr-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {family.history.map((h) => (
                      <tr key={h.id} className="border-t">
                        <td className="pr-3 py-1 whitespace-nowrap">{h.at ? new Date(h.at).toLocaleString() : '–'}</td>
                        <td className="pr-3 py-1">{h.by ?? h.source}</td>
                        <td className="pr-3 py-1">{h.scope}</td>
                        <td className="pr-3 py-1 font-mono text-xs">{h.component}</td>
                        <td className="pr-3 py-1 text-right whitespace-nowrap">
                          {h.remainingBefore} → {h.remainingAfter}
                        </td>
                        <td className="pr-3 py-1">{h.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
