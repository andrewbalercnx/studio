
'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {useUser} from '@/firebase/auth/use-user';
import type {PrintOrder, TicketStatus} from '@/lib/types';
import type {EstimatedTurnaround, OrderStatusCategory, OrderTimeline} from '@/lib/order-timeline';
import {OrderTimelineView} from '@/components/orders/order-timeline';
import {ReportIssueButton} from '@/components/report-issue-button';
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {LoaderCircle, PackageCheck, Mail, MapPin, DollarSign, XCircle, Truck, LifeBuoy, Clock} from 'lucide-react';
import Link from 'next/link';
import {format} from 'date-fns';
import {useToast} from '@/hooks/use-toast';

type StatusFilter = 'all' | OrderStatusCategory;

/**
 * Server-derived order row (Sprint W3-C): the API returns the timeline,
 * status category and ISO timestamps — this page only renders them
 * (server-first principle; no status mapping in the client).
 */
type OrderRow = PrintOrder & {
  createdAtIso: string | null;
  updatedAtIso: string | null;
  rejectedAtIso: string | null;
  statusCategory: OrderStatusCategory;
  timeline: OrderTimeline;
};

type TicketRow = {
  id: string;
  message: string;
  pagePath: string;
  status: TicketStatus;
  resolutionNote: string | null;
  createdAtIso: string | null;
  updatedAtIso: string | null;
};

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

function friendlyIsoDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatFriendlyDate(date);
}

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

function ticketBadgeVariant(status: TicketStatus): 'secondary' | 'default' | 'outline' {
  if (status === 'resolved') return 'default';
  if (status === 'in_progress') return 'outline';
  return 'secondary';
}

export default function ParentOrdersPage() {
  const {user, loading: userLoading} = useUser();
  const {toast} = useToast();
  const [markingOrderId, setMarkingOrderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [allOrders, setAllOrders] = useState<OrderRow[] | null>(null);
  const [estimatedTurnaround, setEstimatedTurnaround] = useState<EstimatedTurnaround | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/printOrders/my-orders', {
        headers: {Authorization: `Bearer ${token}`},
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load orders');
      }
      setAllOrders(data.orders as OrderRow[]);
      setEstimatedTurnaround(data.estimatedTurnaround ?? null);
      setOrdersError(null);
    } catch (error: any) {
      setOrdersError(error?.message ?? 'Failed to load orders');
    } finally {
      setOrdersLoading(false);
    }
  }, [user]);

  const loadTickets = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/tickets', {
        headers: {Authorization: `Bearer ${token}`},
      });
      const data = await response.json();
      if (response.ok && data?.ok) {
        setTickets(data.tickets as TicketRow[]);
      }
    } catch {
      // Tickets are a secondary surface — fail quietly.
    } finally {
      setTicketsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadOrders();
    loadTickets();
  }, [user, loadOrders, loadTickets]);

  // Filter orders by the server-derived status category
  const orders = useMemo(() => {
    if (!allOrders) return null;
    if (statusFilter === 'all') return allOrders;
    return allOrders.filter(order => order.statusCategory === statusFilter);
  }, [allOrders, statusFilter]);

  // Count orders by category for tab badges
  const orderCounts = useMemo(() => {
    const counts = { all: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0 } as Record<StatusFilter, number>;
    if (!allOrders) return counts;
    return allOrders.reduce((acc, order) => {
      acc.all++;
      acc[order.statusCategory]++;
      return acc;
    }, counts);
  }, [allOrders]);

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
      await loadOrders();
    } catch (error: any) {
      toast({title: 'Update failed', description: error?.message ?? 'Could not update payment status.', variant: 'destructive'});
    } finally {
      setMarkingOrderId(null);
    }
  };

  if (userLoading || (user && ordersLoading && !allOrders)) {
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
          <p className="text-muted-foreground">Track every order from placement to delivery.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/stories">Back to Stories</Link>
        </Button>
      </div>

      {estimatedTurnaround && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          {estimatedTurnaround.label}
        </p>
      )}

      {ordersError && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">
            Couldn&apos;t load your orders: {ordersError}
          </CardContent>
        </Card>
      )}

      {/* Status Filter Tabs */}
      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="all" className="gap-2">
            All {orderCounts.all > 0 && <Badge variant="secondary" className="ml-1">{orderCounts.all}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-2">
            Pending {orderCounts.pending > 0 && <Badge variant="secondary" className="ml-1">{orderCounts.pending}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="in_progress" className="gap-2">
            In Progress {orderCounts.in_progress > 0 && <Badge variant="secondary" className="ml-1">{orderCounts.in_progress}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            Completed {orderCounts.completed > 0 && <Badge variant="secondary" className="ml-1">{orderCounts.completed}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="cancelled" className="gap-2">
            Cancelled {orderCounts.cancelled > 0 && <Badge variant="secondary" className="ml-1">{orderCounts.cancelled}</Badge>}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {orders && orders.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((order) => {
            const createdLabel = friendlyIsoDate(order.createdAtIso);
            const updatedLabel = friendlyIsoDate(order.updatedAtIso);
            const isPaid = order.paymentStatus === 'paid';
            const inFlight = order.timeline.state === 'active' || order.timeline.state === 'shipped';
            return (
              <Card key={order.id ?? order.storyId}>
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">Order #{(order.id ?? '').slice(-6) || 'pending'}</CardTitle>
                    <Badge variant={isPaid ? 'default' : 'secondary'}>{order.paymentStatus}</Badge>
                  </div>
                  <CardDescription>
                    {createdLabel ? `Created ${createdLabel}` : 'Pending timestamp'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {/* Order pipeline transparency (Sprint W3-C): server-derived timeline */}
                  <OrderTimelineView timeline={order.timeline} />

                  {inFlight && order.timeline.state === 'active' && estimatedTurnaround && (
                    <p className="text-xs text-muted-foreground">
                      {estimatedTurnaround.label}
                    </p>
                  )}

                  {order.mixamTrackingUrl && (
                    <p>
                      <a
                        href={order.mixamTrackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-medium text-primary underline"
                      >
                        <Truck className="h-4 w-4" />
                        Track your delivery
                        {order.mixamTrackingNumber ? ` (${order.mixamTrackingNumber})` : ''}
                      </a>
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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
                          {friendlyIsoDate(order.rejectedAtIso) && (
                            <p className="text-xs text-red-600 mt-1">
                              Rejected {friendlyIsoDate(order.rejectedAtIso)}
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
                  {updatedLabel && (
                    <p className="text-xs text-muted-foreground">
                      Updated {updatedLabel}
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
            <p className="text-muted-foreground">
              {statusFilter === 'all'
                ? 'No print orders yet. Finalize a book and request copies to see them here.'
                : `No ${statusFilter === 'in_progress' ? 'in progress' : statusFilter} orders.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Support tickets (Sprint W3-C): tracked issue reports with status */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LifeBuoy className="h-5 w-5" />
              Support Tickets
            </CardTitle>
            <CardDescription>
              Issues you&apos;ve reported and where they&apos;re up to.
            </CardDescription>
          </div>
          <ReportIssueButton onReported={loadTickets} />
        </CardHeader>
        <CardContent>
          {ticketsLoading ? (
            <div className="flex justify-center py-4">
              <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tickets && tickets.length > 0 ? (
            <ul className="divide-y">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{ticket.message}</p>
                    <p className="text-xs text-muted-foreground">
                      #{ticket.id.slice(-6)}
                      {friendlyIsoDate(ticket.createdAtIso) ? ` · Reported ${friendlyIsoDate(ticket.createdAtIso)}` : ''}
                    </p>
                    {ticket.status === 'resolved' && ticket.resolutionNote && (
                      <p className="mt-1 text-xs text-emerald-700">{ticket.resolutionNote}</p>
                    )}
                  </div>
                  <Badge variant={ticketBadgeVariant(ticket.status)} className="shrink-0">
                    {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              No tickets — if anything goes wrong, use &quot;Report Issue&quot; and we&apos;ll track it here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
