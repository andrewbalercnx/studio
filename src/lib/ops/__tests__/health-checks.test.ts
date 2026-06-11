import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPS_HEALTH_THRESHOLDS,
  resolveThresholds,
  evaluateArtPending,
  evaluateUnreviewedOrders,
  evaluateErrorRate,
  shouldAlert,
} from '../health-checks';

const HOUR = 60 * 60 * 1000;
const NOW = 1_750_000_000_000;

describe('resolveThresholds', () => {
  it('returns defaults when config is missing', () => {
    expect(resolveThresholds(null)).toEqual(DEFAULT_OPS_HEALTH_THRESHOLDS);
    expect(resolveThresholds(undefined)).toEqual(DEFAULT_OPS_HEALTH_THRESHOLDS);
  });

  it('merges partial overrides over defaults', () => {
    const resolved = resolveThresholds({ artPendingHours: 8 });
    expect(resolved.artPendingHours).toBe(8);
    expect(resolved.ordersUnreviewedHours).toBe(DEFAULT_OPS_HEALTH_THRESHOLDS.ordersUnreviewedHours);
  });

  it('rejects nonsensical values (zero, negative, out-of-range rates)', () => {
    const resolved = resolveThresholds({
      artPendingHours: 0,
      ordersUnreviewedHours: -5,
      errorRateThreshold: 1.7,
      errorRateMinSamples: 0,
    });
    expect(resolved.artPendingHours).toBe(DEFAULT_OPS_HEALTH_THRESHOLDS.artPendingHours);
    expect(resolved.ordersUnreviewedHours).toBe(DEFAULT_OPS_HEALTH_THRESHOLDS.ordersUnreviewedHours);
    expect(resolved.errorRateThreshold).toBe(DEFAULT_OPS_HEALTH_THRESHOLDS.errorRateThreshold);
    expect(resolved.errorRateMinSamples).toBe(DEFAULT_OPS_HEALTH_THRESHOLDS.errorRateMinSamples);
  });
});

describe('evaluateArtPending', () => {
  const thresholds = { ...DEFAULT_OPS_HEALTH_THRESHOLDS, artPendingHours: 4 };

  it('does not breach when nothing is stuck', () => {
    const result = evaluateArtPending(
      [
        { id: 'a', status: 'ready', lastRunAtMs: NOW - 10 * HOUR },
        { id: 'b', status: 'running', lastRunAtMs: NOW - 1 * HOUR }, // recent, still fine
        { id: 'c', status: 'error', lastRunAtMs: NOW - 10 * HOUR }, // failed, not pending
      ],
      NOW,
      thresholds
    );
    expect(result.breached).toBe(false);
  });

  it('breaches when a running storybook is older than the threshold', () => {
    const result = evaluateArtPending(
      [{ id: 'stuck-1', status: 'running', lastRunAtMs: NOW - 5 * HOUR }],
      NOW,
      thresholds
    );
    expect(result.breached).toBe(true);
    expect(result.summary).toContain('1 storybook');
    expect(result.details?.storybookIds).toEqual(['stuck-1']);
  });

  it('treats rate_limited as pending art', () => {
    const result = evaluateArtPending(
      [{ id: 'rl-1', status: 'rate_limited', lastRunAtMs: NOW - 6 * HOUR }],
      NOW,
      thresholds
    );
    expect(result.breached).toBe(true);
  });

  it('ignores candidates with no lastRunAt (never started — nothing to time out)', () => {
    const result = evaluateArtPending([{ id: 'x', status: 'running', lastRunAtMs: null }], NOW, thresholds);
    expect(result.breached).toBe(false);
  });
});

describe('evaluateUnreviewedOrders', () => {
  const thresholds = { ...DEFAULT_OPS_HEALTH_THRESHOLDS, ordersUnreviewedHours: 24 };

  it('does not breach for recent awaiting-approval orders', () => {
    const result = evaluateUnreviewedOrders([{ id: 'o1', createdAtMs: NOW - 2 * HOUR }], NOW, thresholds);
    expect(result.breached).toBe(false);
  });

  it('breaches for orders older than 24h', () => {
    const result = evaluateUnreviewedOrders(
      [
        { id: 'o1', createdAtMs: NOW - 30 * HOUR },
        { id: 'o2', createdAtMs: NOW - 25 * HOUR },
        { id: 'o3', createdAtMs: NOW - 1 * HOUR },
      ],
      NOW,
      thresholds
    );
    expect(result.breached).toBe(true);
    expect(result.details?.count).toBe(2);
    expect(result.details?.orderIds).toEqual(['o1', 'o2']);
  });

  it('skips orders with unknown createdAt', () => {
    const result = evaluateUnreviewedOrders([{ id: 'o1', createdAtMs: null }], NOW, thresholds);
    expect(result.breached).toBe(false);
  });
});

describe('evaluateErrorRate', () => {
  const thresholds = {
    ...DEFAULT_OPS_HEALTH_THRESHOLDS,
    errorRateThreshold: 0.3,
    errorRateMinSamples: 5,
  };

  it('does not breach below the sample floor even at 100% errors', () => {
    const result = evaluateErrorRate(
      [{ status: 'error' }, { status: 'failure' }, { status: 'error' }],
      thresholds
    );
    expect(result.breached).toBe(false);
    expect(result.summary).toContain('min 5');
  });

  it('does not breach at or below the threshold', () => {
    const logs = [
      ...Array(7).fill({ status: 'success' }),
      ...Array(3).fill({ status: 'error' }),
    ];
    expect(evaluateErrorRate(logs, thresholds).breached).toBe(false);
  });

  it('breaches above the threshold and counts failure as error', () => {
    const logs = [
      ...Array(5).fill({ status: 'success' }),
      ...Array(3).fill({ status: 'error' }),
      ...Array(2).fill({ status: 'failure' }),
    ];
    const result = evaluateErrorRate(logs, thresholds);
    expect(result.breached).toBe(true);
    expect(result.details?.errors).toBe(5);
    expect(result.details?.total).toBe(10);
  });

  it('handles an empty window', () => {
    const result = evaluateErrorRate([], thresholds);
    expect(result.breached).toBe(false);
  });
});

describe('shouldAlert (dedup)', () => {
  it('alerts when never alerted before', () => {
    expect(shouldAlert(null, NOW, 6)).toBe(true);
    expect(shouldAlert(undefined, NOW, 6)).toBe(true);
  });

  it('suppresses re-alerts inside the cooldown window', () => {
    expect(shouldAlert(NOW - 1 * HOUR, NOW, 6)).toBe(false);
    expect(shouldAlert(NOW - 5.9 * HOUR, NOW, 6)).toBe(false);
  });

  it('re-alerts once the cooldown has elapsed', () => {
    expect(shouldAlert(NOW - 6 * HOUR, NOW, 6)).toBe(true);
    expect(shouldAlert(NOW - 48 * HOUR, NOW, 6)).toBe(true);
  });
});
