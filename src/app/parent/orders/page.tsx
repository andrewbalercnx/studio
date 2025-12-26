
'use client';

import {useMemo, useState} from 'react';
import {useUser} from '@/firebase/auth/use-user';
import {useFirestore} from '@/firebase';
import {collection, query, where} from 'firebase/firestore';
import {useCollection} from '@/lib/firestore-hooks';
import type {PrintOrder} from '@/lib/types';
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {LoaderCircle, PackageCheck, Mail, MapPin, DollarSign, XCircle} from 'lucide-react';
import Link from 'next/link';
import {format} from 'date-fns';
import {useToast} from '@/hooks/use-toast';

/**
 * Format a date in a friendly format like "12th December 2025"
 */
function formatFriendlyDate(date: Date): string {
  const day = date.getDate();
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd'
    : 'th';
  return `${day}${suffix} ${format(date, 'MMMM yyyy')}`;
}

export default function ParentOrdersPage() {
  const {user, loading: userLoading} = useUser();
  const firestore = useFirestore();
  const {toast} = useToast();
  const [markingOrderId, setMarkingOrderId] = useState<string | null>(null);

  // Query for orders using parentUid
  // Note: We don't use orderBy here to avoid needing composite indexes.
  // Sorting is done in JavaScript after fetching.
  const ordersQuery = useMemo(() => {
    if (!firestore || !user) return null;
    return query(
      collection(firestore, 'printOrders'),
      where('parentUid', '==', user.uid)
    );
  }, [firestore, user]);

  const {data: rawOrders, loading: ordersLoading} = useCollection<PrintOrder>(ordersQuery);

  // Sort orders by createdAt descending
  const orders = useMemo(() => {
    if (!rawOrders) return null;
    return [...rawOrders].sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      return bTime - aTime;
    });
  }, [rawOrders]);

  const handleMarkPaid = async (orderId: string) => {
    if (!user) return;
    setMarkingOrderId(orderId);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/printOrders/${orderId}/pay`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.errorMessage || 'Unable to mark as paid.');
      }
      toast({title: 'Marked as paid'});
    } catch (error: any) {
      toast({title: 'Update failed', description: error?.message ?? 'Could not update payment status.', variant: 'destructive'});
    } finally {
      setMarkingOrderId(null);
    }
  };

  if (userLoading || (ordersLoading && !orders)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <Card className="max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Sign in to view orders</CardTitle>
            <CardDescription>Parent access is required to review print orders.</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href="/login">Sign In</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Print Orders</h1>
          <p className="text-muted-foreground">Track every shipment and simulate payments for testing.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/stories">Back to Stories</Link>
        </Button>
      </div>

      {orders && orders.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((order) => {
            const createdAt = order.createdAt?.toDate ? order.createdAt.toDate() : null;
            const updatedAt = order.updatedAt?.toDate ? order.updatedAt.toDate() : null;
            const isPaid = order.paymentStatus === 'paid';
            return (
              <Card key={order.id ?? order.storyId}>
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">Order #{(order.id ?? '').slice(-6) || 'pending'}</CardTitle>
                    <Badge variant={isPaid ? 'default' : 'secondary'}>{order.paymentStatus}</Badge>
                  </div>
                  <CardDescription>
                    {createdAt ? `Created ${formatFriendlyDate(createdAt)}` : 'Pending timestamp'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="gap-1 text-xs">
                      <PackageCheck className="h-3 w-3" /> {order.fulfillmentStatus}
                    </Badge>
                    <Badge variant="outline">Qty {order.quantity}</Badge>
                    <Badge variant="outline">Version v{order.version}</Badge>
                  </div>

                  {/* Show rejection reason if order was rejected */}
                  {(order.approvalStatus === 'rejected' || (order.fulfillmentStatus === 'cancelled' && order.rejectedReason)) && (
                    <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md">
                      <div className="flex items-start gap-2">
                        <XCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-semibold">Order Rejected</p>
                          {order.rejectedReason && (
                            <p className="text-sm mt-1">{order.rejectedReason}</p>
                          )}
                          {order.rejectedAt && (
                            <p className="text-xs text-red-600 mt-1">
                              Rejected {formatFriendlyDate(
                                order.rejectedAt.toDate ? order.rejectedAt.toDate() : new Date(order.rejectedAt)
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <p>
                    Story Output:{' '}
                    <Link href={`/story/${order.storyId}`} className="font-medium text-primary underline">
                      {order.outputId}
                    </Link>
                  </p>
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    {order.contactEmail}
                  </p>
                  {order.shippingAddress && (
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <MapPin className="mt-1 h-4 w-4" />
                      <div>
                        <p>{order.shippingAddress.name}</p>
                        <p>{order.shippingAddress.line1}</p>
                        {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
                        <p>
                          {order.shippingAddress.city}{order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ''} {order.shippingAddress.postalCode}
                        </p>
                        <p>{order.shippingAddress.country}</p>
                      </div>
                    </div>
                  )}
                  {updatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Updated {formatFriendlyDate(updatedAt)}
                    </p>
                  )}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link href="/stories">Back to Stories</Link>
                  </Button>
                  <Button
                    variant="secondary"
                    className="gap-2"
                    onClick={() => handleMarkPaid(order.id!)}
                    disabled={isPaid || markingOrderId === order.id}
                  >
                    {markingOrderId === order.id && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    <DollarSign className="h-4 w-4" />
                    Mark as Paid (test)
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="text-center py-10">
          <CardContent>
            <PackageCheck className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">No print orders yet. Finalize a book and request copies to see them here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
