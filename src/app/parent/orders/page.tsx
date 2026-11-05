'use client';

/**
 * Parent: the family's printed book orders (slice 5.6), newest first from
 * `GET /api/orders`, each opening its order page to pay, follow or cancel it;
 * then the support tickets. Status labels only; the server decides the status
 * and which actions are possible.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, LoaderCircle, PackageCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SupportTickets } from '@/components/support/support-tickets';
import { useUser } from '@/firebase/auth/use-user';
import { formatMoney, listOrders, ORDER_STATUS_LABELS, type OrderView } from '@/lib/orders/api';

export default function ParentOrdersPage() {
  const { user } = useUser();
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    listOrders()
      .then(setOrders)
      .catch((err: Error) => setError(err.message));
  }, [user]);

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">Printed book orders</h1>

      {error ? (
        <p className="text-red-700">{error}</p>
      ) : !orders ? (
        <div className="flex justify-center py-12">
          <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <Card className="py-10 text-center">
          <CardContent>
            <PackageCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">No print orders yet. Open a finished book and choose &quot;Order a printed copy&quot;.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {orders.length} {orders.length === 1 ? 'order' : 'orders'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {orders.map((order) => (
                <li key={order.id}>
                  <Link href={`/orders/${encodeURIComponent(order.id)}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {order.quantity} {order.quantity === 1 ? 'copy' : 'copies'} · {formatMoney(order.amountMinor, order.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''} · to{' '}
                        {order.shippingAddress.name}, {order.shippingAddress.postalCode}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant={order.actions.canPay ? 'default' : 'secondary'}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <SupportTickets />
    </div>
  );
}
