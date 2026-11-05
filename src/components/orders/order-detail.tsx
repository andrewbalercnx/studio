'use client';

/**
 * One print order for the parent (slice 5.6): status and timeline, the proof
 * PDFs, and the actions the server says are possible (pay by card, pay with
 * print credits, cancel). Checks again every few seconds while something is
 * happening (files being made, payment being confirmed, sending to the printer).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, FileText, Gift, LoaderCircle, Truck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  cancelOrder,
  formatMoney,
  getOrder,
  ORDER_STATUS_LABELS,
  payWithCredits,
  startCheckout,
  type OrderStatus,
  type OrderView,
} from '@/lib/orders/api';

const MOVING: ReadonlySet<OrderStatus> = new Set(['rendering', 'paid', 'submitting']);

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function OrderDetail({ orderId, justPaid, requireGuard }: { orderId: string; justPaid: boolean; requireGuard: () => boolean }) {
  const { toast } = useToast();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'card' | 'credits' | 'cancel'>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await getOrder(orderId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Stripe, the webhook may land a moment after the browser does.
  const waiting = !!order && (MOVING.has(order.status) || (justPaid && order.status === 'awaiting_payment'));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const run = async (kind: 'card' | 'credits' | 'cancel', action: () => Promise<void>) => {
    if (!requireGuard()) return;
    setBusy(kind);
    try {
      await action();
    } catch (err) {
      toast({ title: 'That did not work', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (error && !order) return <p className="py-12 text-center text-amber-800">{error}</p>;
  if (!order) {
    return (
      <div className="flex justify-center py-24">
        <LoaderCircle className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  const proofs = order.render?.status === 'ready' ? order.render.files.filter((f) => f.url) : [];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-amber-900">Printed book order</CardTitle>
            <Badge variant={order.status === 'cancelled' || order.status === 'refunded' ? 'secondary' : 'default'}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          </div>
          <CardDescription>
            {order.quantity} {order.quantity === 1 ? 'copy' : 'copies'} · {formatMoney(order.amountMinor, order.currency)} including UK delivery
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {order.status === 'rendering' && (
            <p className="flex items-center gap-2 text-sm text-amber-800">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Making the print files. This takes about a minute.
            </p>
          )}
          {order.render?.status === 'failed' && <p className="text-sm text-red-700">The print files could not be made: {order.render.error}. You can cancel this order.</p>}
          {justPaid && order.status === 'awaiting_payment' && (
            <p className="flex items-center gap-2 text-sm text-amber-800">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Confirming your payment…
            </p>
          )}

          {order.actions.canPay && (
            <div className="space-y-2">
              <Button className="w-full" disabled={!!busy} onClick={() => run('card', async () => void (window.location.href = (await startCheckout(order.id)).url))}>
                {busy === 'card' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                Pay {formatMoney(order.amountMinor, order.currency)} by card
              </Button>
              {order.actions.canPayWithCredits && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!!busy}
                  onClick={() => run('credits', async () => setOrder(await payWithCredits(order.id)))}
                >
                  {busy === 'credits' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
                  Use {order.quantity} print {order.quantity === 1 ? 'credit' : 'credits'} ({order.creditsAvailable} left)
                </Button>
              )}
            </div>
          )}

          {order.tracking.trackingUrl && (
            <Button asChild variant="outline" className="w-full">
              <a href={order.tracking.trackingUrl} target="_blank" rel="noreferrer">
                <Truck className="mr-2 h-4 w-4" /> Track your parcel
              </a>
            </Button>
          )}

          {proofs.length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-muted-foreground">Proof:</span>
              {proofs.map((f) => (
                <a key={f.role} href={f.url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-amber-700 underline">
                  <FileText className="h-3 w-3" /> {f.role === 'cover' ? 'Cover' : 'Pages'} (PDF)
                </a>
              ))}
            </div>
          )}

          <div className="text-sm text-amber-900">
            <p className="font-medium">Delivering to</p>
            <p>
              {order.shippingAddress.name}, {order.shippingAddress.line1}
              {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ''}, {order.shippingAddress.city} {order.shippingAddress.postalCode}
            </p>
          </div>

          <ol className="space-y-1 border-l-2 border-amber-200 pl-4 text-sm">
            {order.timeline.map((entry, i) => (
              <li key={`${entry.status}-${i}`}>
                <span className="font-medium text-amber-900">{ORDER_STATUS_LABELS[entry.status]}</span>{' '}
                <span className="text-muted-foreground">{when(entry.at)}</span>
              </li>
            ))}
          </ol>

          {order.actions.canCancel && (
            <Button
              variant="ghost"
              className="w-full text-red-700"
              disabled={!!busy}
              onClick={() => {
                const refund = order.payment.method === 'stripe' ? ' Your card payment will be refunded.' : order.payment.method === 'credit' ? ' Your print credits will be returned.' : '';
                if (!window.confirm(`Cancel this order?${refund}`)) return;
                void run('cancel', async () => setOrder(await cancelOrder(order.id)));
              }}
            >
              {busy === 'cancel' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
              Cancel order
            </Button>
          )}
        </CardContent>
      </Card>
      <p className="text-center text-sm">
        <Link href={`/books/${encodeURIComponent(order.bookId)}`} className="text-amber-700 underline">
          Back to the book
        </Link>
        {' · '}
        <Link href="/parent/orders" className="text-amber-700 underline">
          All orders
        </Link>
      </p>
    </div>
  );
}
