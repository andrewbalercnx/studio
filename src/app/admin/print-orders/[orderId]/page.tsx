'use client';

/**
 * Admin: one print order (slice 5.6, the v2 order service): payment,
 * approval, Mixam state and the timeline, with the admin actions: approve,
 * mark paid (audited, a note is required), retry submission (forced only after
 * checking Mixam), refresh from Mixam, and cancel (at Mixam first, then refund).
 */
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import {
  adminCancelOrder,
  approveOrder,
  formatMoney,
  getAdminOrder,
  markOrderPaid,
  ORDER_STATUS_LABELS,
  refreshOrder,
  retrySubmit,
  type AdminOrderView,
} from '@/lib/orders/api';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 break-words">{children ?? '—'}</span>
    </div>
  );
}

export default function AdminPrintOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { toast } = useToast();
  const { isAuthenticated, isAdmin, loading: authLoading } = useAdminStatus();
  const [order, setOrder] = useState<AdminOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOrder(await getAdminOrder(orderId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orderId]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const act = async (label: string, action: () => Promise<AdminOrderView>) => {
    setBusy(true);
    try {
      setOrder(await action());
      toast({ title: label });
    } catch (err) {
      toast({ title: 'That did not work', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) return <LoaderCircle className="m-8 h-6 w-6 animate-spin" />;
  if (!isAuthenticated || !isAdmin) return <p className="p-6">You must be an admin to view this page.</p>;
  if (error && !order) return <p className="p-6 text-red-700">{error}</p>;
  if (!order) return <LoaderCircle className="m-8 h-6 w-6 animate-spin" />;

  const s = order.status;
  const terminal = s === 'shipped' || s === 'delivered' || s === 'cancelled' || s === 'refunded';
  const canRetry = !order.mixam.orderId && (s === 'submitting' || (s === 'paid' && order.approval?.required === false) || (s === 'awaiting_approval' && !!order.approval?.approvedAt));
  const proofs = order.render?.files.filter((f) => f.url) ?? [];

  return (
    <div className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-xl">{order.id}</h1>
        <Link href="/admin/print-orders" className="text-sm underline">
          All orders
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">{ORDER_STATUS_LABELS[s]}</CardTitle>
          {order.nextAction !== 'none' && <Badge variant="destructive">{order.nextAction === 'approve' ? 'Needs approval' : 'Needs a retry'}</Badge>}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {order.nextAction === 'approve' && (
            <Button disabled={busy} onClick={() => void act('Approved: sending to Mixam', () => approveOrder(order.id))}>
              Approve and send to Mixam
            </Button>
          )}
          {s === 'awaiting_payment' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const note = window.prompt('Why is this order being marked paid? (kept on the order)');
                if (note?.trim()) void act('Marked paid', () => markOrderPaid(order.id, note.trim()));
              }}
            >
              Mark paid…
            </Button>
          )}
          {canRetry && (
            <Button variant="outline" disabled={busy} onClick={() => void act('Submit retried', () => retrySubmit(order.id, false))}>
              Retry submit
            </Button>
          )}
          {canRetry && order.mixam.requestStartedAt && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Only force a resubmit after checking the Mixam dashboard: this order may already be there. Continue?')) {
                  void act('Submit forced', () => retrySubmit(order.id, true));
                }
              }}
            >
              Force resubmit…
            </Button>
          )}
          {order.mixam.orderId && (
            <Button variant="outline" disabled={busy} onClick={() => void act('Refreshed from Mixam', () => refreshOrder(order.id))}>
              Refresh from Mixam
            </Button>
          )}
          {!terminal && (
            <Button
              variant="ghost"
              className="text-red-700"
              disabled={busy}
              onClick={() => {
                const note = window.prompt('Cancel this order? It is cancelled at Mixam first if sent, then refunded. Note (optional):');
                if (note !== null) void act('Cancelled', () => adminCancelOrder(order.id, note.trim() || null));
              }}
            >
              Cancel order…
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Order</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Book">
            <Link href={`/books/${encodeURIComponent(order.bookId)}`} className="underline">
              {order.bookId}
            </Link>
          </Row>
          <Row label="Owner">{order.ownerUid}</Row>
          <Row label="Template">{order.layoutId}</Row>
          <Row label="Copies">
            {order.quantity} × {formatMoney(order.unitAmountMinor, order.currency)} = {formatMoney(order.amountMinor, order.currency)}
          </Row>
          <Row label="Deliver to">
            {order.shippingAddress.name}, {order.shippingAddress.line1}
            {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city} {order.shippingAddress.postalCode}
          </Row>
          <Row label="Contact">{order.contactEmail}</Row>
          <Row label="Render">
            {order.renderId}
            {proofs.map((f) => (
              <a key={f.role} href={f.url!} target="_blank" rel="noreferrer" className="ml-2 underline">
                {f.role}
              </a>
            ))}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment and Mixam</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Paid by">{order.payment.method}</Row>
          <Row label="Paid at">{order.payment.paidAt}</Row>
          <Row label="Refunded">{order.payment.refundedAt}</Row>
          <Row label="Payment detail">
            <code className="text-xs">{JSON.stringify(order.paymentDetail)}</code>
          </Row>
          <Row label="Approval">
            {order.approval ? (order.approval.required ? (order.approval.approvedAt ? `approved by ${order.approval.approvedBy} at ${order.approval.approvedAt}` : 'required, not yet given') : 'not required') : null}
          </Row>
          <Row label="Mixam order">{order.mixam.orderId ? `${order.mixam.orderId} (job ${order.mixam.jobNumber ?? '?'})` : null}</Row>
          <Row label="Mixam status">{order.mixam.status}</Row>
          <Row label="Tracking">
            {order.mixam.trackingUrl ? (
              <a href={order.mixam.trackingUrl} target="_blank" rel="noreferrer" className="underline">
                {order.mixam.trackingUrl}
              </a>
            ) : null}
          </Row>
          <Row label="Request sent at">{order.mixam.requestStartedAt}</Row>
          <Row label="Last error">{order.mixam.lastError ? <span className="text-red-700">{order.mixam.lastError}</span> : null}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1 text-sm">
            {order.timeline.map((t, i) => (
              <li key={i}>
                <span className="font-medium">{ORDER_STATUS_LABELS[t.status]}</span> · {new Date(t.at).toLocaleString('en-GB')} · {t.by}
                {t.note ? ` · ${t.note}` : ''}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
