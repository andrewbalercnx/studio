import { describe, expect, it } from 'vitest';
import {
  deriveOrderTimeline,
  deriveOrderStatusCategory,
  formatEstimatedTurnaround,
  ORDER_TIMELINE_STEPS,
  type OrderTimelineStepId,
} from '@/lib/order-timeline';
import type { MixamOrderStatus } from '@/lib/types';

const ALL_STATUSES: MixamOrderStatus[] = [
  'draft', 'validating', 'validation_failed', 'ready_to_submit', 'awaiting_approval',
  'approved', 'submitting', 'submitted', 'confirmed', 'in_production', 'on_hold',
  'shipped', 'delivered', 'cancelled', 'failed',
];

function stepState(timeline: ReturnType<typeof deriveOrderTimeline>, id: OrderTimelineStepId) {
  return timeline.steps.find((s) => s.id === id)!.state;
}

describe('deriveOrderTimeline', () => {
  it('uses the canonical five parent-facing steps in order', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'awaiting_approval' });
    expect(t.steps.map((s) => s.id)).toEqual(['placed', 'review', 'submitted', 'printing', 'shipped']);
    expect(ORDER_TIMELINE_STEPS).toHaveLength(5);
  });

  it('a freshly placed order is under review', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'awaiting_approval' });
    expect(stepState(t, 'placed')).toBe('complete');
    expect(stepState(t, 'review')).toBe('current');
    expect(stepState(t, 'submitted')).toBe('upcoming');
    expect(t.currentStepId).toBe('review');
    expect(t.state).toBe('active');
    expect(t.attention).toBe(false);
  });

  it.each(['draft', 'validating', 'ready_to_submit'] as const)(
    'pre-approval status %s stays at review',
    (status) => {
      const t = deriveOrderTimeline({ fulfillmentStatus: status });
      expect(t.currentStepId).toBe('review');
    }
  );

  it('approved/submitting orders are being sent to the printer', () => {
    for (const status of ['approved', 'submitting'] as const) {
      const t = deriveOrderTimeline({ fulfillmentStatus: status });
      expect(stepState(t, 'review')).toBe('complete');
      expect(t.currentStepId).toBe('submitted');
    }
  });

  it('submitted/confirmed/in_production orders are at the printing step', () => {
    for (const status of ['submitted', 'confirmed', 'in_production'] as const) {
      const t = deriveOrderTimeline({ fulfillmentStatus: status });
      expect(stepState(t, 'submitted')).toBe('complete');
      expect(t.currentStepId).toBe('printing');
      expect(t.state).toBe('active');
    }
  });

  it('shipped completes all steps with state "shipped"', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'shipped' });
    expect(t.steps.every((s) => s.state === 'complete')).toBe(true);
    expect(t.state).toBe('shipped');
    expect(t.currentStepId).toBeNull();
  });

  it('delivered completes all steps with state "delivered"', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'delivered' });
    expect(t.steps.every((s) => s.state === 'complete')).toBe(true);
    expect(t.state).toBe('delivered');
  });

  it('cancelled/failed orders are terminal with no progress bar beyond placed', () => {
    const cancelled = deriveOrderTimeline({ fulfillmentStatus: 'cancelled' });
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.currentStepId).toBeNull();
    expect(stepState(cancelled, 'placed')).toBe('complete');
    expect(stepState(cancelled, 'review')).toBe('upcoming');

    const failed = deriveOrderTimeline({ fulfillmentStatus: 'failed' });
    expect(failed.state).toBe('failed');
  });

  it('on_hold keeps printing current and raises attention', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'on_hold' });
    expect(t.currentStepId).toBe('printing');
    expect(t.attention).toBe(true);
    expect(t.attentionNote).toBeTruthy();
  });

  it('validation_failed stays in review with attention', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'validation_failed' });
    expect(t.currentStepId).toBe('review');
    expect(t.attention).toBe(true);
  });

  it('an unknown future status degrades gracefully to just-placed', () => {
    const t = deriveOrderTimeline({ fulfillmentStatus: 'some_new_status' });
    expect(t.state).toBe('active');
    expect(t.currentStepId).toBe('review');
  });

  it('attaches timestamps from createdAt and statusHistory to completed steps only', () => {
    const t = deriveOrderTimeline({
      fulfillmentStatus: 'in_production',
      createdAtIso: '2026-06-01T10:00:00.000Z',
      statusHistory: [
        { status: 'awaiting_approval', timestamp: '2026-06-01T10:00:00.000Z' },
        { status: 'approved', timestamp: '2026-06-02T09:00:00.000Z' },
        { status: 'submitted', timestamp: '2026-06-02T09:05:00.000Z' },
      ],
    });
    expect(t.steps.find((s) => s.id === 'placed')!.at).toBe('2026-06-01T10:00:00.000Z');
    expect(t.steps.find((s) => s.id === 'review')!.at).toBe('2026-06-02T09:00:00.000Z');
    expect(t.steps.find((s) => s.id === 'submitted')!.at).toBe('2026-06-02T09:05:00.000Z');
    // printing is current, not complete — no timestamp
    expect(t.steps.find((s) => s.id === 'printing')!.at).toBeUndefined();
  });

  it('covers every known fulfilment status without throwing', () => {
    for (const status of ALL_STATUSES) {
      expect(() => deriveOrderTimeline({ fulfillmentStatus: status })).not.toThrow();
    }
  });
});

describe('deriveOrderStatusCategory', () => {
  it('buckets every status into the four filter tabs', () => {
    expect(deriveOrderStatusCategory('awaiting_approval')).toBe('pending');
    expect(deriveOrderStatusCategory('validation_failed')).toBe('pending');
    expect(deriveOrderStatusCategory('approved')).toBe('in_progress');
    expect(deriveOrderStatusCategory('on_hold')).toBe('in_progress');
    expect(deriveOrderStatusCategory('in_production')).toBe('in_progress');
    expect(deriveOrderStatusCategory('shipped')).toBe('completed');
    expect(deriveOrderStatusCategory('delivered')).toBe('completed');
    expect(deriveOrderStatusCategory('cancelled')).toBe('cancelled');
    expect(deriveOrderStatusCategory('failed')).toBe('cancelled');
    expect(deriveOrderStatusCategory('something_else')).toBe('pending');
  });
});

describe('formatEstimatedTurnaround', () => {
  it('formats a range with honest estimate labelling', () => {
    const e = formatEstimatedTurnaround(10, 15);
    expect(e.minBusinessDays).toBe(10);
    expect(e.maxBusinessDays).toBe(15);
    expect(e.label).toContain('10–15 business days');
    expect(e.label.toLowerCase()).toContain('estimate');
  });

  it('collapses equal bounds and clamps inverted/low values', () => {
    expect(formatEstimatedTurnaround(7, 7).label).toContain('Estimated 7 business days');
    const inverted = formatEstimatedTurnaround(9, 4);
    expect(inverted.maxBusinessDays).toBeGreaterThanOrEqual(inverted.minBusinessDays);
    expect(formatEstimatedTurnaround(0, 0).minBusinessDays).toBe(1);
  });
});
