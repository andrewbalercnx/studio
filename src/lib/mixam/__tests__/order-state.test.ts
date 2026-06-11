import { describe, it, expect } from 'vitest';
import { deriveAdminNextAction, buildFailureSummary } from '../order-state';

describe('deriveAdminNextAction', () => {
  const cases: Array<[string, string, boolean]> = [
    // [fulfillmentStatus, expected action, expected urgent]
    ['draft', 'none', false],
    ['validating', 'monitor', false],
    ['validation_failed', 'fix_artwork', true],
    ['ready_to_submit', 'review_approval', true],
    ['awaiting_approval', 'review_approval', true],
    ['approved', 'submit_to_mixam', true],
    ['submitting', 'monitor', false],
    ['submitted', 'confirm_order', true],
    ['confirmed', 'monitor', false],
    ['in_production', 'monitor', false],
    ['on_hold', 'investigate_hold', true],
    ['shipped', 'monitor', false],
    ['delivered', 'none', false],
    ['cancelled', 'none', false],
    ['failed', 'investigate_failure', true],
  ];

  it.each(cases)('maps %s → %s (urgent=%s)', (status, action, urgent) => {
    const result = deriveAdminNextAction({ fulfillmentStatus: status });
    expect(result.action).toBe(action);
    expect(result.urgent).toBe(urgent);
    expect(result.label.length).toBeGreaterThan(0);
  });

  it('is case-insensitive on status', () => {
    expect(deriveAdminNextAction({ fulfillmentStatus: 'SUBMITTED' }).action).toBe('confirm_order');
  });

  it('maps unknown statuses to monitor (non-urgent), never crashing', () => {
    const result = deriveAdminNextAction({ fulfillmentStatus: 'some_future_status' });
    expect(result.action).toBe('monitor');
    expect(result.urgent).toBe(false);
  });

  it('artwork errors override non-terminal statuses', () => {
    for (const status of ['submitted', 'in_production', 'on_hold', 'awaiting_approval']) {
      const result = deriveAdminNextAction({ fulfillmentStatus: status, hasArtworkErrors: true });
      expect(result.action).toBe('fix_artwork');
      expect(result.urgent).toBe(true);
    }
  });

  it('artwork errors do NOT override terminal statuses', () => {
    expect(deriveAdminNextAction({ fulfillmentStatus: 'delivered', hasArtworkErrors: true }).action).toBe('none');
    expect(deriveAdminNextAction({ fulfillmentStatus: 'cancelled', hasArtworkErrors: true }).action).toBe('none');
  });

  it('includes the hold reason in the on_hold label when provided', () => {
    const result = deriveAdminNextAction({ fulfillmentStatus: 'on_hold', statusReason: 'Payment pending' });
    expect(result.label).toContain('Payment pending');
  });
});

describe('buildFailureSummary', () => {
  it('returns null when there is nothing to report', () => {
    expect(buildFailureSummary({ fulfillmentStatus: 'in_production' })).toBeNull();
  });

  it('prioritises artwork errors and counts extras', () => {
    const summary = buildFailureSummary({
      fulfillmentStatus: 'on_hold',
      mixamArtworkErrors: [
        { page: 3, message: 'Image resolution too low' },
        { page: 7, message: 'Bleed missing' },
      ],
      mixamStatusReason: 'On hold for artwork',
    });
    expect(summary).toContain('Page 3: Image resolution too low');
    expect(summary).toContain('+1 more');
  });

  it('reports validation errors when invalid', () => {
    const summary = buildFailureSummary({
      fulfillmentStatus: 'validation_failed',
      validationResult: { valid: false, errors: ['Page count below minimum', 'Cover missing'] },
    });
    expect(summary).toContain('Validation: Page count below minimum');
    expect(summary).toContain('+1 more');
  });

  it('ignores validationResult when valid', () => {
    expect(
      buildFailureSummary({ fulfillmentStatus: 'approved', validationResult: { valid: true, errors: [] } })
    ).toBeNull();
  });

  it('reports rejection and Mixam status reasons', () => {
    expect(buildFailureSummary({ rejectedReason: 'Inappropriate content' })).toContain('Rejected:');
    expect(buildFailureSummary({ mixamStatusReason: 'Awaiting payment' })).toContain('Mixam: Awaiting payment');
  });

  it('only surfaces fulfillmentNotes for problem states', () => {
    expect(buildFailureSummary({ fulfillmentStatus: 'on_hold', fulfillmentNotes: 'Call Mixam' })).toBe('Call Mixam');
    expect(buildFailureSummary({ fulfillmentStatus: 'shipped', fulfillmentNotes: 'Routine note' })).toBeNull();
  });

  it('truncates very long summaries to a bounded length', () => {
    const summary = buildFailureSummary({ mixamStatusReason: 'x'.repeat(500) });
    expect(summary!.length).toBeLessThanOrEqual(210);
    expect(summary!.endsWith('…')).toBe(true);
  });
});
