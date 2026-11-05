/**
 * PrintOrder transitions (slice 5.5b). One table says which moves are legal;
 * every status change goes through `transition`, which appends to
 * `statusHistory`, so the timeline a parent sees is the audit trail.
 */
import { ConflictError } from '../errors';
import type { OrderStatus, PrintOrderV2, StatusEntry } from '../data/schemas/order';

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  rendering: ['awaiting_payment', 'cancelled'],
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['awaiting_approval', 'submitting', 'cancelled', 'refunded'],
  awaiting_approval: ['submitting', 'cancelled', 'refunded'],
  submitting: ['submitted', 'cancelled', 'refunded'],
  submitted: ['in_production', 'shipped', 'delivered', 'cancelled', 'refunded'],
  in_production: ['shipped', 'delivered', 'cancelled', 'refunded'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: ['refunded'],
  refunded: [],
};

/** Paid, not yet handed to Mixam: the parent may still cancel (with a refund). */
export const PARENT_CANCELLABLE: ReadonlySet<OrderStatus> = new Set(['rendering', 'awaiting_payment', 'paid', 'awaiting_approval']);
/** Statuses in which money has been taken (Stripe, credits or an admin mark-paid). */
export const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set(['paid', 'awaiting_approval', 'submitting', 'submitted', 'in_production', 'shipped', 'delivered']);
/** Mixam progress, forward only. */
export const FULFILMENT_RANK: Partial<Record<OrderStatus, number>> = { submitted: 1, in_production: 2, shipped: 3, delivered: 4 };

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The patch for a status change; throws 409 ORDER_STATE when the move is not allowed. */
export function transition(
  order: Pick<PrintOrderV2, 'status' | 'statusHistory'>,
  to: OrderStatus,
  by: string,
  at: Date,
  note: string | null = null
): { status: OrderStatus; statusHistory: StatusEntry[] } {
  if (!canTransition(order.status, to)) {
    throw new ConflictError(`An order that is ${order.status.replace('_', ' ')} cannot become ${to.replace('_', ' ')}`, {
      code: 'ORDER_STATE',
      details: { from: order.status, to },
    });
  }
  return { status: to, statusHistory: [...order.statusHistory, { status: to, at: at.toISOString(), by, note }] };
}

/** Map a Mixam status onto ours; null when it is not a forward step we track (on hold, cancelled at Mixam, unknown). */
export function mixamStatusToOrder(status: string): OrderStatus | null {
  switch (status.toUpperCase().replace(/[\s-]/g, '_')) {
    case 'PENDING':
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'ACCEPTED':
      return 'submitted';
    case 'INPRODUCTION':
    case 'IN_PRODUCTION':
    case 'PRINTING':
      return 'in_production';
    case 'DISPATCHED':
    case 'SHIPPED':
      return 'shipped';
    case 'DELIVERED':
      return 'delivered';
    default:
      return null;
  }
}

/** Whether a Mixam-reported status moves this order forward. */
export function isForwardFulfilment(current: OrderStatus, next: OrderStatus): boolean {
  const from = FULFILMENT_RANK[current];
  const to = FULFILMENT_RANK[next];
  return from !== undefined && to !== undefined && to > from;
}
