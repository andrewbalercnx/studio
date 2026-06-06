/**
 * Generation reliability primitives, consolidated.
 *
 * Three pure(ish) pieces used by the AI flows and the `/api/storybookV2/*`
 * routes so retry/backoff behaviour lives in ONE place instead of being
 * re-implemented per flow:
 *
 *  1. `classifyError`     — decide retryable vs not (5xx/timeout = retry,
 *                           4xx/quota = don't).
 *  2. `computeBackoffMs`  — exponential backoff with full jitter and a low cap.
 *  3. `withRetry`         — drive the above to retry a transient operation.
 *  4. `CircuitBreaker`    — in-memory fast-fail scaffold keyed per provider.
 *
 * The classifier and backoff functions are deterministic given their inputs
 * (jitter takes an injectable RNG) so they are exhaustively unit-tested.
 */

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ErrorClass =
  /** Transient: safe to retry (5xx, timeout, connection reset, UNAVAILABLE). */
  | 'transient'
  /** Rate limit / quota: a transient class but should back off harder / trip
   *  the breaker rather than hammer. NOT retried inline by default. */
  | 'rate_limit'
  /** Permanent: a 4xx / bad-request / content-filter — retrying won't help. */
  | 'permanent';

/** Patterns that mean "you are being throttled / out of quota". */
const RATE_LIMIT_PATTERNS = [
  'RESOURCE_EXHAUSTED',
  '429',
  'quota',
  'rate limit',
  'rate_limit',
  'too many requests',
];

/** Patterns that mean "transient infra hiccup, try again". */
const TRANSIENT_PATTERNS = [
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'timed out',
  'timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'socket hang up',
  'temporarily',
  '500',
  '502',
  '503',
  '504',
  'internal error',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
];

/** Patterns that mean "this will never succeed on retry". */
const PERMANENT_PATTERNS = [
  'INVALID_ARGUMENT',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'NOT_FOUND',
  'FAILED_PRECONDITION',
  '400',
  '401',
  '403',
  '404',
  '422',
  'safety',
  'blocked',
  'content policy',
  'did not match the expected pattern',
];

function extractMessage(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message ?? '';
  const anyErr = error as { message?: unknown; toString?: () => string };
  if (typeof anyErr.message === 'string') return anyErr.message;
  try {
    return String(error);
  } catch {
    return '';
  }
}

function matchesAny(haystack: string, patterns: string[]): boolean {
  return patterns.some((p) => haystack.includes(p));
}

/**
 * Classify a raw error into a retry disposition. Order matters:
 * rate-limit wins over generic transient (it carries different backoff intent),
 * and permanent signals win over everything (never retry a 4xx even if the
 * string also happens to contain a transient-looking token).
 */
export function classifyError(error: unknown): ErrorClass {
  const message = extractMessage(error);
  // Permanent first: a 4xx must never be masked by an incidental transient token.
  if (matchesAny(message, PERMANENT_PATTERNS)) return 'permanent';
  if (matchesAny(message, RATE_LIMIT_PATTERNS)) return 'rate_limit';
  if (matchesAny(message, TRANSIENT_PATTERNS)) return 'transient';
  // Unknown errors are treated as permanent: failing fast is safer than a retry
  // storm against an unclassified failure.
  return 'permanent';
}

/** Convenience: should this error be retried inline by `withRetry`? */
export function isRetryable(error: unknown): boolean {
  return classifyError(error) === 'transient';
}

// ---------------------------------------------------------------------------
// Backoff schedule (exponential + full jitter, low cap)
// ---------------------------------------------------------------------------

export type BackoffOptions = {
  /** Base delay in ms for the first retry (default 500). */
  baseMs?: number;
  /** Hard ceiling on any single delay in ms (default 8000 — a low cap). */
  capMs?: number;
  /** Multiplier per attempt (default 2). */
  factor?: number;
  /**
   * Injectable RNG returning [0, 1) for full-jitter. Defaults to Math.random.
   * Tests pass a deterministic generator.
   */
  rng?: () => number;
};

const DEFAULT_BASE_MS = 500;
const DEFAULT_CAP_MS = 8000;
const DEFAULT_FACTOR = 2;

/**
 * Full-jitter exponential backoff.
 *
 * `attempt` is 0-based (0 = the delay before the FIRST retry, i.e. after the
 * initial try failed). The exponential ceiling is `min(cap, base * factor^attempt)`
 * and the returned delay is a uniformly random value in `[0, ceiling]` (AWS
 * "full jitter"). With a fixed RNG the result is fully deterministic.
 */
export function computeBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const {
    baseMs = DEFAULT_BASE_MS,
    capMs = DEFAULT_CAP_MS,
    factor = DEFAULT_FACTOR,
    rng = Math.random,
  } = options;

  const safeAttempt = Math.max(0, Math.floor(attempt));
  const exponential = baseMs * Math.pow(factor, safeAttempt);
  const ceiling = Math.min(capMs, exponential);
  const jittered = rng() * ceiling;
  return Math.round(jittered);
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

export type WithRetryOptions = BackoffOptions & {
  /** Max retry attempts AFTER the initial try (low cap; default 2 → 3 tries). */
  maxRetries?: number;
  /** Sleep implementation (injectable for tests). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Decide whether an error is retryable. Defaults to `isRetryable`. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each backoff sleep — wire this to ai-flow-logger. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
};

const DEFAULT_MAX_RETRIES = 2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn`, retrying transient failures with jittered exponential backoff up to
 * a low cap. Non-retryable errors (4xx / quota / unknown) throw immediately so a
 * provider outage does not become a self-inflicted retry storm. The last error
 * is rethrown once retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep = defaultSleep,
    shouldRetry = isRetryable,
    onRetry,
    ...backoff
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const hasRetriesLeft = attempt < maxRetries;
      if (!hasRetriesLeft || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = computeBackoffMs(attempt, backoff);
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  // Unreachable in practice (loop either returns or throws), but satisfies TS.
  throw lastError;
}

// ---------------------------------------------------------------------------
// Circuit breaker (in-memory scaffold, keyed per provider)
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerOptions = {
  /** Consecutive failures before the circuit opens (default 5). */
  failureThreshold?: number;
  /** How long to stay open before allowing a probe, ms (default 30_000). */
  cooldownMs?: number;
  /** Clock injectable for tests. Defaults to Date.now. */
  now?: () => number;
};

/**
 * A minimal consecutive-failure circuit breaker.
 *
 * - `closed`: requests flow; each failure increments a counter, a success
 *   resets it. Hitting the threshold opens the circuit.
 * - `open`: `canRequest()` fast-fails (returns false) until the cooldown
 *   elapses, then transitions to `half_open`.
 * - `half_open`: a single probe is allowed; success closes the circuit, failure
 *   re-opens it for another cooldown.
 *
 * State is in-memory per process. This is a scaffold; the at-scale version would
 * persist counters in `systemConfig` so it is shared across instances.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** Current state, after applying any pending cooldown→half-open transition. */
  getState(): CircuitState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half_open';
    }
    return this.state;
  }

  /** Whether a request should be attempted right now. */
  canRequest(): boolean {
    return this.getState() !== 'open';
  }

  /** Record a successful call: resets failures and closes the circuit. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  /** Record a failed call: may open (from closed) or re-open (from half-open). */
  recordFailure(): void {
    // Re-evaluate cooldown so a failure during cooldown is treated in the
    // correct state.
    const state = this.getState();
    if (state === 'half_open') {
      // The probe failed — back to open for another cooldown.
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.trip();
    }
  }

  /** Force the circuit open (used internally and exposed for tests). */
  private trip(): void {
    this.state = 'open';
    this.openedAt = this.now();
  }

  /** Reset to the initial closed state. */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }

  /** Consecutive failure count (for diagnostics/tests). */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }
}

/**
 * Process-wide breakers keyed by provider id so the image route and image flow
 * share one breaker per provider. Lazily created.
 */
const providerBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  providerKey: string,
  options?: CircuitBreakerOptions
): CircuitBreaker {
  let breaker = providerBreakers.get(providerKey);
  if (!breaker) {
    breaker = new CircuitBreaker(options);
    providerBreakers.set(providerKey, breaker);
  }
  return breaker;
}

/** Test-only helper to clear the shared registry between cases. */
export function __resetCircuitBreakers(): void {
  providerBreakers.clear();
}
