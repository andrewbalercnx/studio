'use client';

/**
 * Admin: print orders (slice 5.6, the v2 order service). The approval switch
 * and approval emails (`systemConfig/orders`), the Stripe mode, and every
 * order newest first with what an admin should do next. Refreshes every 30 s.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import {
  formatMoney,
  getOrderSettings,
  listAdminOrders,
  ORDER_STATUS_LABELS,
  updateOrderSettings,
  type AdminOrderView,
  type OrderSettings,
  type OrderStatus,
} from '@/lib/orders/api';

const FILTERS: Array<{ key: OrderStatus | null; label: string }> = [
  { key: null, label: 'All' },
  { key: 'awaiting_approval', label: 'Waiting for approval' },
  { key: 'awaiting_payment', label: 'Waiting for payment' },
  { key: 'submitting', label: 'Sending' },
  { key: 'submitted', label: 'With Mixam' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'cancelled', label: 'Cancelled' },
];

function SettingsCard() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<OrderSettings | null>(null);
  const [emails, setEmails] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOrderSettings()
      .then((s) => {
        setSettings(s);
        setEmails(s.notifyEmails.join(', '));
      })
      .catch((err: Error) => toast({ title: 'Could not load order settings', description: err.message, variant: 'destructive' }));
  }, [toast]);

  const save = async (patch: Parameters<typeof updateOrderSettings>[0]) => {
    setSaving(true);
    try {
      const next = await updateOrderSettings(patch);
      setSettings(next);
      setEmails(next.notifyEmails.join(', '));
      toast({ title: 'Order settings saved' });
    } catch (err) {
      toast({ title: 'Could not save', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;
  const stripe = settings.stripeMode === null ? 'not configured (card payments off)' : settings.stripeMode === 'fake' ? 'fake (TEST_MODE)' : `${settings.stripeMode} mode`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Settings</CardTitle>
        <CardDescription>Stripe: {stripe}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Approve paid orders before they go to Mixam</span>
            <span className="text-sm text-muted-foreground">Off: paid orders are sent to Mixam straight away.</span>
          </span>
          <Switch checked={settings.requireAdminApproval} disabled={saving} onCheckedChange={(on) => void save({ requireAdminApproval: on })} />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 space-y-1">
            <span className="text-sm font-medium">Email when an order waits for approval</span>
            <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com, …" />
          </label>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void save({ notifyEmails: emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean) })}
          >
            Save emails
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPrintOrdersPage() {
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const [filter, setFilter] = useState<OrderStatus | null>(null);
  const [orders, setOrders] = useState<AdminOrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders(await listAdminOrders(filter));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [isAdmin, load]);

  if (authLoading) return <LoaderCircle className="m-8 h-6 w-6 animate-spin" />;
  if (!isAuthenticated || !isAdmin) return <p className="p-6">You must be an admin to view this page.</p>;

  return (
    <div className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Print orders</h1>
        <Link href="/admin" className="text-sm underline">
          Back to Admin
        </Link>
      </div>

      <SettingsCard />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.label} size="sm" variant={filter === f.key ? 'default' : 'outline'} onClick={() => setFilter(f.key)}>
            {f.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-red-700">{error}</p>}
      {!orders ? (
        <LoaderCircle className="h-6 w-6 animate-spin" />
      ) : orders.length === 0 ? (
        <p className="text-muted-foreground">No orders.</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {orders.length} {orders.length === 1 ? 'order' : 'orders'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/print-orders/${encodeURIComponent(o.id)}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-muted/40">
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">{o.id}</span>
                      <span className="text-xs text-muted-foreground">
                        {o.createdAt ? new Date(o.createdAt).toLocaleString('en-GB') : ''} · {o.quantity} × {o.layoutId} · {formatMoney(o.amountMinor, o.currency)}
                        {o.payment.method ? ` · ${o.payment.method}` : ''}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {o.nextAction !== 'none' && <Badge variant="destructive">{o.nextAction === 'approve' ? 'Approve' : 'Retry'}</Badge>}
                      <Badge variant="secondary">{ORDER_STATUS_LABELS[o.status]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
