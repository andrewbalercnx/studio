/**
 * Firestore-backed (systemConfig) circuit breaker — the cross-instance version
 * of the in-memory scaffold in `ai-retry.ts`.
 *
 * Why: the app runs on serverless instances, so an in-memory breaker only sees
 * the failures of its own process and never trips consistently during a real
 * provider outage. This implementation persists per-provider failure counters
 * in `systemConfig/circuitBreakers` so EVERY instance fast-fails together, and
 * a provider outage degrades gracefully instead of becoming a fleet-wide retry
 * storm that burns AI tokens.
 *
 * Design (mirrors the systemConfig pattern used by `ai-model-config.ts`):
 * - Short-TTL in-memory cache (default 5s) so the hot path costs at most one
 *   Firestore read per instance per TTL window, not one per request.
 * - State transitions (failure increments, open/close) are Firestore
 *   transactions so concurrent instances cannot lose updates.
 * - Successes only write when there is something to reset (closed + zero
 *   failures = no write), keeping the happy path cheap.
 * - Firestore problems NEVER block generation: every breaker operation fails
 *   open (allow the request) and logs a warning.
 *
 * Timestamps are stored as epoch milliseconds (not server Timestamps) so the
 * cooldown math is pure and the module is fully unit-testable with a fake
 * Firestore.
 */

import { classifyError, isRetryable, withRetry, type CircuitState, type WithRetryOptions } from './ai-retry';

export const CIRCUIT_BREAKER_DOC_PATH = 'systemConfig/circuitBreakers';

/** Per-provider state as persisted in the systemConfig doc. */
export type PersistedBreakerState = {
  state: CircuitState;
  consecutiveFailures: number;
  /** Epoch ms when the circuit last opened (0 = never). */
  openedAtMs: number;
  /** Epoch ms of the last update (diagnostics). */
  updatedAtMs: number;
};

const INITIAL_STATE: PersistedBreakerState = {
  state: 'closed',
  consecutiveFailures: 0,
  openedAtMs: 0,
  updatedAtMs: 0,
};

// ---------------------------------------------------------------------------
// Minimal structural Firestore interface (satisfied by firebase-admin and by
// the in-memory fake used in tests).
// ---------------------------------------------------------------------------

export type BreakerDocSnapshot = {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

export type BreakerDocRef = {
  get: () => Promise<BreakerDocSnapshot>;
};

export type BreakerTransaction = {
  get: (ref: BreakerDocRef) => Promise<BreakerDocSnapshot>;
  set: (ref: BreakerDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => unknown;
};

export type BreakerFirestore = {
  doc: (path: string) => BreakerDocRef;
  runTransaction: <T>(fn: (tx: BreakerTransaction) => Promise<T>) => Promise<T>;
};

/** Lazily resolve the real admin Firestore (kept out of module scope so tests
 *  can inject a fake without touching firebase-admin). */
async function getDefaultFirestore(): Promise<BreakerFirestore> {
  const { initFirebaseAdminApp } = await import('@/firebase/admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  await initFirebaseAdminApp();
  return getFirestore() as unknown as BreakerFirestore;
}

// ---------------------------------------------------------------------------
// DistributedCircuitBreaker
// ---------------------------------------------------------------------------

export type DistributedCircuitBreakerOptions = {
  /** Consecutive (cross-instance) failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long to stay open before allowing a probe, ms. Default 60_000. */
  cooldownMs?: number;
  /** How long the in-memory snapshot of the Firestore state is trusted. Default 5_000. */
  cacheTtlMs?: number;
  /** Injectable Firestore (tests pass a fake). */
  firestore?: BreakerFirestore | (() => Promise<BreakerFirestore>);
  /** Injectable clock. Default Date.now. */
  now?: () => number;
};

export class DistributedCircuitBreaker {
  private readonly providerKey: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly firestoreSource: BreakerFirestore | (() => Promise<BreakerFirestore>);

  private cached: PersistedBreakerState = { ...INITIAL_STATE };
  private cacheExpiresAtMs = 0;

  constructor(providerKey: string, options: DistributedCircuitBreakerOptions = {}) {
    this.providerKey = providerKey;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.firestoreSource = options.firestore ?? getDefaultFirestore;
  }

  private async firestore(): Promise<BreakerFirestore> {
    return typeof this.firestoreSource === 'function'
      ? await this.firestoreSource()
      : this.firestoreSource;
  }

  private docRef(fs: BreakerFirestore): BreakerDocRef {
    return fs.doc(CIRCUIT_BREAKER_DOC_PATH);
  }

  private readPersisted(snap: BreakerDocSnapshot): PersistedBreakerState {
    if (!snap.exists) return { ...INITIAL_STATE };
    const data = snap.data() ?? {};
    const providers = (data.providers ?? {}) as Record<string, Partial<PersistedBreakerState>>;
    const raw = providers[this.providerKey];
    if (!raw) return { ...INITIAL_STATE };
    return {
      state: raw.state ?? 'closed',
      consecutiveFailures: raw.consecutiveFailures ?? 0,
      openedAtMs: raw.openedAtMs ?? 0,
      updatedAtMs: raw.updatedAtMs ?? 0,
    };
  }

  /** Apply the time-based open -> half_open transition to a persisted state. */
  private effectiveState(persisted: PersistedBreakerState): CircuitState {
    if (persisted.state === 'open' && this.now() - persisted.openedAtMs >= this.cooldownMs) {
      return 'half_open';
    }
    return persisted.state;
  }

  /** Refresh the in-memory snapshot from Firestore if the TTL has lapsed. */
  private async refreshCache(force = false): Promise<void> {
    if (!force && this.now() < this.cacheExpiresAtMs) return;
    try {
      const fs = await this.firestore();
      const snap = await this.docRef(fs).get();
      this.cached = this.readPersisted(snap);
      this.cacheExpiresAtMs = this.now() + this.cacheTtlMs;
    } catch (e) {
      // Fail open: a broken breaker store must never block generation.
      console.warn(`[ai-circuit-breaker] Failed to read breaker state for "${this.providerKey}", failing open:`, e);
      this.cacheExpiresAtMs = this.now() + this.cacheTtlMs;
    }
  }

  /** Current effective state (refreshes the cache when stale). */
  async getState(): Promise<CircuitState> {
    await this.refreshCache();
    return this.effectiveState(this.cached);
  }

  /** Whether a request should be attempted right now (cached read). */
  async canRequest(): Promise<boolean> {
    return (await this.getState()) !== 'open';
  }

  /**
   * Synchronous check against the last-known snapshot — used inside retry
   * loops where we must not await a Firestore read between attempts.
   */
  canRequestSync(): boolean {
    return this.effectiveState(this.cached) !== 'open';
  }

  /** Record a successful provider call. Cheap no-op when already clean. */
  async recordSuccess(): Promise<void> {
    // Skip the write when our snapshot says there is nothing to reset.
    if (this.cached.state === 'closed' && this.cached.consecutiveFailures === 0) return;
    try {
      const fs = await this.firestore();
      const ref = this.docRef(fs);
      const next = await fs.runTransaction(async (tx) => {
        const persisted = this.readPersisted(await tx.get(ref));
        const reset: PersistedBreakerState = {
          state: 'closed',
          consecutiveFailures: 0,
          openedAtMs: persisted.openedAtMs,
          updatedAtMs: this.now(),
        };
        tx.set(ref, { providers: { [this.providerKey]: reset } }, { merge: true });
        return reset;
      });
      this.cached = next;
      this.cacheExpiresAtMs = this.now() + this.cacheTtlMs;
    } catch (e) {
      console.warn(`[ai-circuit-breaker] Failed to record success for "${this.providerKey}":`, e);
    }
  }

  /**
   * Record a failed provider call (callers should only count transient /
   * rate-limit failures — a safety block is not a provider outage). Opens the
   * circuit at the threshold; a failed half-open probe re-opens immediately.
   */
  async recordFailure(): Promise<void> {
    try {
      const fs = await this.firestore();
      const ref = this.docRef(fs);
      const next = await fs.runTransaction(async (tx) => {
        const persisted = this.readPersisted(await tx.get(ref));
        const state = this.effectiveState(persisted);
        let updated: PersistedBreakerState;
        if (state === 'half_open') {
          // Probe failed — straight back to open for another cooldown.
          updated = {
            state: 'open',
            consecutiveFailures: persisted.consecutiveFailures + 1,
            openedAtMs: this.now(),
            updatedAtMs: this.now(),
          };
        } else {
          const failures = persisted.consecutiveFailures + 1;
          const opens = failures >= this.failureThreshold;
          updated = {
            state: opens ? 'open' : state,
            consecutiveFailures: failures,
            openedAtMs: opens ? this.now() : persisted.openedAtMs,
            updatedAtMs: this.now(),
          };
        }
        tx.set(ref, { providers: { [this.providerKey]: updated } }, { merge: true });
        return updated;
      });
      this.cached = next;
      this.cacheExpiresAtMs = this.now() + this.cacheTtlMs;
    } catch (e) {
      console.warn(`[ai-circuit-breaker] Failed to record failure for "${this.providerKey}":`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Registry + reliability wrapper
// ---------------------------------------------------------------------------

const breakers = new Map<string, DistributedCircuitBreaker>();

export function getDistributedCircuitBreaker(
  providerKey: string,
  options?: DistributedCircuitBreakerOptions
): DistributedCircuitBreaker {
  let breaker = breakers.get(providerKey);
  if (!breaker) {
    breaker = new DistributedCircuitBreaker(providerKey, options);
    breakers.set(providerKey, breaker);
  }
  return breaker;
}

/** Test-only helper to clear the registry between cases. */
export function __resetDistributedCircuitBreakers(): void {
  breakers.clear();
}

/**
 * Thrown when the circuit for a provider is open. The message intentionally
 * contains "service unavailable" so `toUserSafeMessage` maps it to the
 * friendly outage copy, and callers can detect it via `code`.
 */
export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN';
  readonly providerKey: string;
  constructor(providerKey: string) {
    super(`Provider "${providerKey}" circuit is open — service unavailable, fast-failing without retry.`);
    this.name = 'CircuitOpenError';
    this.providerKey = providerKey;
  }
}

export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return !!error && typeof error === 'object' && (error as CircuitOpenError).code === 'CIRCUIT_OPEN';
}

export type ProviderReliabilityOptions = WithRetryOptions & {
  breaker?: DistributedCircuitBreaker;
};

/**
 * The standard reliability wrapper for a provider call:
 *
 * 1. Fast-fail with `CircuitOpenError` when the shared circuit is open —
 *    NO retries during a sustained outage (graceful degradation instead of a
 *    token-burning retry storm).
 * 2. Otherwise run the call under `withRetry` (exponential backoff + jitter,
 *    low cap, transient-only).
 * 3. Each transient/rate-limit failure increments the shared breaker; each
 *    success resets it. Permanent errors (4xx/safety) never trip the breaker.
 * 4. If the breaker opens mid-retry (e.g. another instance tripped it),
 *    remaining retries are abandoned.
 */
export async function withProviderReliability<T>(
  providerKey: string,
  fn: () => Promise<T>,
  options: ProviderReliabilityOptions = {}
): Promise<T> {
  const { breaker: injectedBreaker, ...retryOptions } = options;
  const breaker = injectedBreaker ?? getDistributedCircuitBreaker(providerKey);

  if (!(await breaker.canRequest())) {
    throw new CircuitOpenError(providerKey);
  }

  const userShouldRetry = retryOptions.shouldRetry ?? isRetryable;

  return withRetry(
    async () => {
      try {
        const result = await fn();
        await breaker.recordSuccess();
        return result;
      } catch (error) {
        const errorClass = classifyError(error);
        if (errorClass === 'transient' || errorClass === 'rate_limit') {
          await breaker.recordFailure();
        }
        throw error;
      }
    },
    {
      ...retryOptions,
      shouldRetry: (error) => breaker.canRequestSync() && userShouldRetry(error),
    }
  );
}
