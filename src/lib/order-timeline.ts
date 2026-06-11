/**
 * Order pipeline transparency (Sprint W3-C).
 *
 * Pure derivation of a parent-facing order progress timeline from the
 * `printOrders` fulfilment status machine. Lives in lib (no Firebase imports)
 * so the SAME mapping is used server-side (API responses) and is trivially
 * unit-testable. Per the server-first principle, clients receive the derived
 * timeline in API responses and only render it — they never re-derive it.
 *
 * The five parent-visible stages deliberately collapse the fifteen internal
 * `MixamOrderStatus` values: parents care about "where is my book", not about
 * the validation/submission micro-states.
 */
import type { MixamOrderStatus } from '@/lib/types';

export type OrderTimelineStepId = 'placed' | 'review' | 'submitted' | 'printing' | 'shipped';
export type OrderTimelineStepState = 'complete' | 'current' | 'upcoming';

export type OrderTimelineStep = {
  id: OrderTimelineStepId;
  label: string;
  state: OrderTimelineStepState;
  /** ISO timestamp for when the step completed, when known. */
  at?: string;
};

/**
 * Overall timeline state. `active` means the order is progressing through the
 * steps; `shipped`/`delivered` are happy terminals; `cancelled`/`failed` are
 * sad terminals (clients show a banner instead of a progress bar).
 */
export type OrderTimelineState = 'active' | 'shipped' | 'delivered' | 'cancelled' | 'failed';

export type OrderTimeline = {
  steps: OrderTimelineStep[];
  state: OrderTimelineState;
  /** The step currently in progress (null for terminal states). */
  currentStepId: OrderTimelineStepId | null;
  /** True when the order needs attention (on hold / file problems). */
  attention: boolean;
  attentionNote?: string;
};

/** Filter buckets for the parent orders page (server-derived; was client logic). */
export type OrderStatusCategory = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type OrderTimelineInput = {
  fulfillmentStatus: MixamOrderStatus | string;
  /** ISO string of order creation, used for the "placed" step timestamp. */
  createdAtIso?: string | null;
  /** The order's statusHistory entries (timestamps are ISO strings). */
  statusHistory?: Array<{ status: string; timestamp?: string }> | null;
};

export const ORDER_TIMELINE_STEPS: ReadonlyArray<{ id: OrderTimelineStepId; label: string }> = [
  { id: 'placed', label: 'Order placed' },
  { id: 'review', label: 'Quality review' },
  { id: 'submitted', label: 'Sent to printer' },
  { id: 'printing', label: 'Printing' },
  { id: 'shipped', label: 'Shipped' },
];

/**
 * How many steps are complete for each fulfilment status. The "current" step
 * is the first incomplete one. Unknown statuses are treated conservatively as
 * just-placed so a new internal status never breaks the parent UI.
 */
function completedSteps(status: string): number {
  switch (status) {
    case 'draft':
    case 'validating':
    case 'validation_failed':
    case 'ready_to_submit':
    case 'awaiting_approval':
      return 1; // placed; under review
    case 'approved':
    case 'submitting':
      return 2; // review passed; sending to printer
    case 'submitted':
    case 'confirmed':
    case 'in_production':
    case 'on_hold':
      return 3; // at the printer; printing in progress (or paused)
    case 'shipped':
    case 'delivered':
      return 5;
    default:
      return 1;
  }
}

function attentionFor(status: string): { attention: boolean; attentionNote?: string } {
  switch (status) {
    case 'validation_failed':
      return {
        attention: true,
        attentionNote:
          "We found a problem preparing your book's print files. We're looking into it — no action needed from you.",
      };
    case 'on_hold':
      return {
        attention: true,
        attentionNote: "The printer has paused this order while something is checked. We're on it.",
      };
    default:
      return { attention: false };
  }
}

/** First statusHistory timestamp whose status is in `statuses`, as ISO string. */
function historyTimestamp(
  history: OrderTimelineInput['statusHistory'],
  statuses: string[]
): string | undefined {
  if (!history) return undefined;
  for (const entry of history) {
    if (entry && statuses.includes(entry.status) && typeof entry.timestamp === 'string') {
      return entry.timestamp;
    }
  }
  return undefined;
}

/**
 * Derive the parent-facing timeline for an order.
 *
 * placed → review → submitted (sent to printer) → printing → shipped, with
 * `delivered` marking the whole timeline complete and `cancelled`/`failed`
 * switching to a terminal state (steps stay at "placed" so clients render a
 * cancellation banner rather than a misleading progress bar).
 */
export function deriveOrderTimeline(input: OrderTimelineInput): OrderTimeline {
  const status = input.fulfillmentStatus;

  if (status === 'cancelled' || status === 'failed') {
    return {
      steps: ORDER_TIMELINE_STEPS.map((step, idx) => ({
        ...step,
        state: idx === 0 ? 'complete' : 'upcoming',
        ...(idx === 0 && input.createdAtIso ? { at: input.createdAtIso } : {}),
      })),
      state: status === 'cancelled' ? 'cancelled' : 'failed',
      currentStepId: null,
      attention: false,
    };
  }

  const done = completedSteps(status);
  const stepCompletionTimestamps: Record<OrderTimelineStepId, string | undefined> = {
    placed: input.createdAtIso ?? undefined,
    review: historyTimestamp(input.statusHistory, ['approved']),
    submitted: historyTimestamp(input.statusHistory, ['submitted', 'confirmed']),
    printing: historyTimestamp(input.statusHistory, ['shipped']),
    shipped: historyTimestamp(input.statusHistory, ['shipped']),
  };

  const steps: OrderTimelineStep[] = ORDER_TIMELINE_STEPS.map((step, idx) => {
    const state: OrderTimelineStepState = idx < done ? 'complete' : idx === done ? 'current' : 'upcoming';
    const at = state === 'complete' ? stepCompletionTimestamps[step.id] : undefined;
    return { ...step, state, ...(at ? { at } : {}) };
  });

  const currentStep = steps.find((s) => s.state === 'current') ?? null;
  const state: OrderTimelineState =
    status === 'delivered' ? 'delivered' : status === 'shipped' ? 'shipped' : 'active';

  return {
    steps,
    state,
    currentStepId: state === 'active' ? (currentStep?.id ?? null) : null,
    ...attentionFor(status),
  };
}

/**
 * Bucket an order for the parent orders page filter tabs. This used to live
 * client-side in `src/app/parent/orders/page.tsx`; it is now derived on the
 * server (my-orders API) per the server-first principle.
 */
export function deriveOrderStatusCategory(status: MixamOrderStatus | string): OrderStatusCategory {
  switch (status) {
    case 'draft':
    case 'validating':
    case 'validation_failed':
    case 'ready_to_submit':
    case 'awaiting_approval':
      return 'pending';
    case 'approved':
    case 'submitting':
    case 'submitted':
    case 'confirmed':
    case 'in_production':
    case 'on_hold':
      return 'in_progress';
    case 'shipped':
    case 'delivered':
      return 'completed';
    case 'cancelled':
    case 'failed':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/** Parent-facing turnaround estimate, honestly labelled as an estimate. */
export type EstimatedTurnaround = {
  minBusinessDays: number;
  maxBusinessDays: number;
  /** Pre-formatted honest label, e.g. "Estimated 10–15 business days …". */
  label: string;
};

export function formatEstimatedTurnaround(minDays: number, maxDays: number): EstimatedTurnaround {
  const lo = Math.max(1, Math.round(minDays));
  const hi = Math.max(lo, Math.round(maxDays));
  const range = lo === hi ? `${lo}` : `${lo}–${hi}`;
  return {
    minBusinessDays: lo,
    maxBusinessDays: hi,
    label: `Estimated ${range} business days from order to delivery — this is an estimate, not a guarantee.`,
  };
}
