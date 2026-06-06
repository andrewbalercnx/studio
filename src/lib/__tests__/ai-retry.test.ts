import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyError,
  isRetryable,
  computeBackoffMs,
  withRetry,
  CircuitBreaker,
  getCircuitBreaker,
  __resetCircuitBreakers,
} from '@/lib/ai-retry';

describe('classifyError', () => {
  it('classifies 5xx / timeout / connection errors as transient', () => {
    expect(classifyError(new Error('503 Service Unavailable'))).toBe('transient');
    expect(classifyError('UNAVAILABLE: backend down')).toBe('transient');
    expect(classifyError('DEADLINE_EXCEEDED')).toBe('transient');
    expect(classifyError('request timed out')).toBe('transient');
    expect(classifyError('ECONNRESET')).toBe('transient');
    expect(classifyError('socket hang up')).toBe('transient');
    expect(classifyError('502 Bad Gateway')).toBe('transient');
  });

  it('classifies quota / 429 / rate limit as rate_limit', () => {
    expect(classifyError('RESOURCE_EXHAUSTED')).toBe('rate_limit');
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('rate_limit');
    expect(classifyError('quota exceeded')).toBe('rate_limit');
    expect(classifyError('rate limit reached')).toBe('rate_limit');
  });

  it('classifies 4xx / bad-request / content as permanent', () => {
    expect(classifyError('400 Bad Request')).toBe('permanent');
    expect(classifyError('INVALID_ARGUMENT')).toBe('permanent');
    expect(classifyError('PERMISSION_DENIED')).toBe('permanent');
    expect(classifyError('blocked by safety filter')).toBe('permanent');
    expect(classifyError('did not match the expected pattern')).toBe('permanent');
  });

  it('treats unknown / empty errors as permanent (fail fast, no retry storm)', () => {
    expect(classifyError(new Error('something weird happened'))).toBe('permanent');
    expect(classifyError(null)).toBe('permanent');
    expect(classifyError(undefined)).toBe('permanent');
    expect(classifyError({})).toBe('permanent');
  });

  it('permanent signals win over incidental transient tokens', () => {
    // contains both '400' (permanent) and 'timeout' (transient) -> permanent
    expect(classifyError('400 error after timeout')).toBe('permanent');
  });

  it('isRetryable only true for transient', () => {
    expect(isRetryable('503')).toBe(true);
    expect(isRetryable('429')).toBe(false); // rate_limit is not inline-retried
    expect(isRetryable('400')).toBe(false);
  });
});

describe('computeBackoffMs', () => {
  it('produces exponential ceilings before jitter (rng=1 returns full ceiling)', () => {
    const opts = { baseMs: 500, factor: 2, capMs: 8000, rng: () => 1 };
    expect(computeBackoffMs(0, opts)).toBe(500); // 500 * 2^0
    expect(computeBackoffMs(1, opts)).toBe(1000); // 500 * 2^1
    expect(computeBackoffMs(2, opts)).toBe(2000); // 500 * 2^2
    expect(computeBackoffMs(3, opts)).toBe(4000); // 500 * 2^3
  });

  it('caps the ceiling at capMs', () => {
    const opts = { baseMs: 500, factor: 2, capMs: 8000, rng: () => 1 };
    expect(computeBackoffMs(4, opts)).toBe(8000); // 8000 capped (would be 8000)
    expect(computeBackoffMs(10, opts)).toBe(8000); // capped
  });

  it('applies full jitter: result is in [0, ceiling]', () => {
    const opts = { baseMs: 500, factor: 2, capMs: 8000, rng: () => 0.5 };
    expect(computeBackoffMs(2, opts)).toBe(1000); // 0.5 * 2000
    const zero = computeBackoffMs(2, { ...opts, rng: () => 0 });
    expect(zero).toBe(0);
  });

  it('clamps negative attempts to 0', () => {
    const opts = { baseMs: 500, factor: 2, capMs: 8000, rng: () => 1 };
    expect(computeBackoffMs(-5, opts)).toBe(500);
  });
});

describe('withRetry', () => {
  const noSleep = async () => {};

  it('returns immediately on success without retrying', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return 'ok';
    }, { sleep: noSleep });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries transient failures up to maxRetries then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('503 transient');
      return 'recovered';
    }, { sleep: noSleep, maxRetries: 2, rng: () => 0 });
    expect(result).toBe('recovered');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('does NOT retry a permanent (4xx) error', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error('400 bad request');
      }, { sleep: noSleep, maxRetries: 3 })
    ).rejects.toThrow('400 bad request');
    expect(calls).toBe(1); // no retries
  });

  it('does NOT retry rate_limit by default', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error('429 quota');
      }, { sleep: noSleep, maxRetries: 3 })
    ).rejects.toThrow('429');
    expect(calls).toBe(1);
  });

  it('rethrows the last error when retries are exhausted', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error('503 still down');
      }, { sleep: noSleep, maxRetries: 2, rng: () => 0 })
    ).rejects.toThrow('503 still down');
    expect(calls).toBe(3);
  });

  it('invokes onRetry before each backoff with attempt + delay', async () => {
    const events: Array<{ attempt: number; delayMs: number }> = [];
    let calls = 0;
    await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('timeout');
      return 'done';
    }, {
      sleep: noSleep,
      maxRetries: 3,
      baseMs: 100,
      factor: 2,
      rng: () => 1,
      onRetry: (info) => events.push({ attempt: info.attempt, delayMs: info.delayMs }),
    });
    expect(events).toEqual([
      { attempt: 1, delayMs: 100 },
      { attempt: 2, delayMs: 200 },
    ]);
  });
});

describe('CircuitBreaker', () => {
  it('starts closed and allows requests', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    expect(cb.getState()).toBe('closed');
    expect(cb.canRequest()).toBe(true);
  });

  it('opens after the failure threshold of consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => 0 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure(); // 3rd -> trips
    expect(cb.getState()).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('a success resets the consecutive failure counter', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, now: () => 0 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed'); // only 2 since reset
  });

  it('transitions open -> half_open after cooldown', () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure(); // opens at t=0
    expect(cb.getState()).toBe('open');
    clock = 999;
    expect(cb.getState()).toBe('open'); // still cooling
    clock = 1000;
    expect(cb.getState()).toBe('half_open'); // cooldown elapsed
    expect(cb.canRequest()).toBe(true); // probe allowed
  });

  it('half_open success closes the circuit', () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure();
    clock = 1000;
    expect(cb.getState()).toBe('half_open');
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('half_open failure re-opens for another cooldown', () => {
    let clock = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => clock });
    cb.recordFailure(); // open at 0
    clock = 1000; // half_open
    expect(cb.getState()).toBe('half_open');
    cb.recordFailure(); // probe fails -> re-open at 1000
    expect(cb.getState()).toBe('open');
    clock = 1999;
    expect(cb.getState()).toBe('open');
    clock = 2000;
    expect(cb.getState()).toBe('half_open');
  });

  it('reset() returns to the initial closed state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, now: () => 0 });
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
  });
});

describe('getCircuitBreaker registry', () => {
  beforeEach(() => __resetCircuitBreakers());

  it('returns the same breaker for the same key', () => {
    const a = getCircuitBreaker('gemini');
    const b = getCircuitBreaker('gemini');
    expect(a).toBe(b);
  });

  it('returns distinct breakers for distinct keys', () => {
    const a = getCircuitBreaker('gemini');
    const b = getCircuitBreaker('elevenlabs');
    expect(a).not.toBe(b);
  });
});
