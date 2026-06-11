import { describe, it, expect, beforeEach } from 'vitest';
import {
  DistributedCircuitBreaker,
  withProviderReliability,
  CircuitOpenError,
  isCircuitOpenError,
  CIRCUIT_BREAKER_DOC_PATH,
  type BreakerFirestore,
  type BreakerDocSnapshot,
} from '../ai-circuit-breaker.server';

/**
 * Minimal in-memory Firestore fake: one shared document store, merge-aware
 * set, sequential transactions. Two breaker instances pointed at the same
 * fake simulate two serverless instances sharing systemConfig.
 */
function makeFakeFirestore() {
  const docs = new Map<string, Record<string, any>>();
  let reads = 0;
  let writes = 0;

  function deepMerge(target: Record<string, any>, source: Record<string, any>) {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = deepMerge({ ...(target[key] ?? {}) }, value);
      } else {
        target[key] = value;
      }
    }
    return target;
  }

  function snapshot(path: string): BreakerDocSnapshot {
    reads += 1;
    const data = docs.get(path);
    return { exists: data !== undefined, data: () => data };
  }

  const firestore: BreakerFirestore = {
    doc: (path: string) => ({
      get: async () => snapshot(path),
      // @ts-expect-error - path attached for the fake transaction
      __path: path,
    }),
    runTransaction: async (fn) =>
      fn({
        get: async (ref: any) => snapshot(ref.__path),
        set: (ref: any, data: Record<string, any>, options?: { merge?: boolean }) => {
          writes += 1;
          const existing = docs.get(ref.__path) ?? {};
          docs.set(ref.__path, options?.merge ? deepMerge({ ...existing }, data) : data);
        },
      }),
  };

  return {
    firestore,
    docs,
    counts: () => ({ reads, writes }),
    getProvider: (key: string) => docs.get(CIRCUIT_BREAKER_DOC_PATH)?.providers?.[key],
  };
}

function makeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const transientError = () => new Error('503 service unavailable');
const permanentError = () => new Error('400 INVALID_ARGUMENT');

describe('DistributedCircuitBreaker', () => {
  let fake: ReturnType<typeof makeFakeFirestore>;
  let clock: ReturnType<typeof makeClock>;

  beforeEach(() => {
    fake = makeFakeFirestore();
    clock = makeClock();
  });

  const makeBreaker = (overrides = {}) =>
    new DistributedCircuitBreaker('test-provider', {
      failureThreshold: 3,
      cooldownMs: 60_000,
      cacheTtlMs: 5_000,
      firestore: fake.firestore,
      now: clock.now,
      ...overrides,
    });

  it('starts closed and allows requests', async () => {
    const breaker = makeBreaker();
    expect(await breaker.canRequest()).toBe(true);
    expect(await breaker.getState()).toBe('closed');
  });

  it('trips open at the failure threshold and persists the state', async () => {
    const breaker = makeBreaker();
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.canRequest()).toBe(true);
    await breaker.recordFailure();
    expect(await breaker.canRequest()).toBe(false);
    expect(fake.getProvider('test-provider')).toMatchObject({
      state: 'open',
      consecutiveFailures: 3,
    });
  });

  it('a success resets the persisted failure counter', async () => {
    const breaker = makeBreaker();
    await breaker.recordFailure();
    await breaker.recordFailure();
    await breaker.recordSuccess();
    expect(fake.getProvider('test-provider')).toMatchObject({
      state: 'closed',
      consecutiveFailures: 0,
    });
    await breaker.recordFailure();
    expect(await breaker.canRequest()).toBe(true); // 1 < threshold again
  });

  it('does not write on success when already clean (cheap happy path)', async () => {
    const breaker = makeBreaker();
    const before = fake.counts().writes;
    await breaker.recordSuccess();
    expect(fake.counts().writes).toBe(before);
  });

  it('transitions open -> half_open after the cooldown, and a probe failure re-opens', async () => {
    const breaker = makeBreaker();
    for (let i = 0; i < 3; i++) await breaker.recordFailure();
    expect(await breaker.getState()).toBe('open');

    clock.advance(60_000);
    expect(await breaker.getState()).toBe('half_open');
    expect(await breaker.canRequest()).toBe(true);

    await breaker.recordFailure(); // probe failed
    expect(await breaker.getState()).toBe('open');

    clock.advance(60_000);
    expect(await breaker.getState()).toBe('half_open');
    await breaker.recordSuccess(); // probe succeeded
    expect(await breaker.getState()).toBe('closed');
  });

  it('CROSS-INSTANCE: a trip by instance A is seen by instance B via systemConfig', async () => {
    const instanceA = makeBreaker();
    const instanceB = makeBreaker();

    // Instance B reads while everything is healthy (primes its cache).
    expect(await instanceB.canRequest()).toBe(true);

    // Instance A observes the outage and trips the shared breaker.
    for (let i = 0; i < 3; i++) await instanceA.recordFailure();
    expect(await instanceA.canRequest()).toBe(false);

    // Within B's cache TTL it still trusts its stale snapshot...
    expect(instanceB.canRequestSync()).toBe(true);
    // ...but once the TTL lapses, B re-reads systemConfig and fast-fails too.
    clock.advance(5_001);
    expect(await instanceB.canRequest()).toBe(false);
  });

  it('CROSS-INSTANCE: failures from different instances accumulate in one counter', async () => {
    const instanceA = makeBreaker();
    const instanceB = makeBreaker();
    await instanceA.recordFailure();
    await instanceB.recordFailure();
    await instanceA.recordFailure(); // 3rd shared failure -> trip
    expect(fake.getProvider('test-provider')).toMatchObject({
      state: 'open',
      consecutiveFailures: 3,
    });
  });

  it('fails OPEN (allows requests) when the breaker store itself errors', async () => {
    const breaker = new DistributedCircuitBreaker('test-provider', {
      firestore: {
        doc: () => ({
          get: async () => {
            throw new Error('firestore down');
          },
        }),
        runTransaction: async () => {
          throw new Error('firestore down');
        },
      },
      now: clock.now,
    });
    expect(await breaker.canRequest()).toBe(true);
    await expect(breaker.recordFailure()).resolves.toBeUndefined();
  });

  it('caches reads within the TTL (at most one Firestore read per window)', async () => {
    const breaker = makeBreaker();
    await breaker.canRequest();
    const after = fake.counts().reads;
    await breaker.canRequest();
    await breaker.canRequest();
    expect(fake.counts().reads).toBe(after);
    clock.advance(5_001);
    await breaker.canRequest();
    expect(fake.counts().reads).toBe(after + 1);
  });
});

describe('withProviderReliability', () => {
  let fake: ReturnType<typeof makeFakeFirestore>;
  let clock: ReturnType<typeof makeClock>;
  const sleep = async () => {};

  beforeEach(() => {
    fake = makeFakeFirestore();
    clock = makeClock();
  });

  const makeBreaker = () =>
    new DistributedCircuitBreaker('img', {
      failureThreshold: 3,
      cooldownMs: 60_000,
      cacheTtlMs: 5_000,
      firestore: fake.firestore,
      now: clock.now,
    });

  it('retries transient failures and records the eventual success', async () => {
    const breaker = makeBreaker();
    let calls = 0;
    const result = await withProviderReliability(
      'img',
      async () => {
        calls += 1;
        if (calls < 3) throw transientError();
        return 'ok';
      },
      { breaker, maxRetries: 2, sleep, rng: () => 0 }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(fake.getProvider('img')).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
  });

  it('does NOT retry permanent errors and does NOT trip the breaker on them', async () => {
    const breaker = makeBreaker();
    let calls = 0;
    await expect(
      withProviderReliability(
        'img',
        async () => {
          calls += 1;
          throw permanentError();
        },
        { breaker, maxRetries: 2, sleep, rng: () => 0 }
      )
    ).rejects.toThrow('INVALID_ARGUMENT');
    expect(calls).toBe(1);
    expect(fake.getProvider('img')).toBeUndefined(); // never wrote a failure
  });

  it('fast-fails with CircuitOpenError (zero provider calls) once the circuit is open', async () => {
    const breaker = makeBreaker();
    for (let i = 0; i < 3; i++) await breaker.recordFailure();

    let calls = 0;
    const attempt = withProviderReliability(
      'img',
      async () => {
        calls += 1;
        return 'ok';
      },
      { breaker, sleep }
    );
    await expect(attempt).rejects.toBeInstanceOf(CircuitOpenError);
    await expect(
      withProviderReliability('img', async () => 'ok', { breaker, sleep }).catch((e) => {
        expect(isCircuitOpenError(e)).toBe(true);
        throw e;
      })
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('abandons remaining retries when the breaker trips mid-flight', async () => {
    const breaker = makeBreaker();
    let calls = 0;
    await expect(
      withProviderReliability(
        'img',
        async () => {
          calls += 1;
          throw transientError();
        },
        { breaker, maxRetries: 10, sleep, rng: () => 0 }
      )
    ).rejects.toThrow('503');
    // Threshold is 3: attempts 1-3 fail and trip the breaker, then shouldRetry
    // sees the open circuit and stops — not 11 calls.
    expect(calls).toBe(3);
    expect(fake.getProvider('img')).toMatchObject({ state: 'open' });
  });
});
