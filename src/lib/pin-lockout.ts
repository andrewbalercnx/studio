/**
 * Parent-PIN brute-force lockout state machine (pure logic, unit-tested).
 *
 * State lives on the users/{uid} doc:
 *  - pinFailedAttempts: number — consecutive failures since the last success/lock
 *  - pinLockedUntil: Timestamp — verification refused until this time
 *
 * Policy: MAX_FAILED_ATTEMPTS consecutive failures lock verification for
 * LOCKOUT_MS. Setting the lock resets the counter, so an expired lock grants a
 * fresh window of attempts. A successful verification clears both fields.
 *
 * The Firestore transaction plumbing stays in the verify-pin route; this
 * module owns the decisions.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;

/** Accepts a Firestore Timestamp, epoch ms number, or nothing. */
type LockedUntilLike = number | { toMillis(): number } | null | undefined;

export type PinLockoutState = {
  pinFailedAttempts?: unknown;
  pinLockedUntil?: LockedUntilLike;
};

function lockedUntilMs(value: LockedUntilLike): number {
  if (typeof value === 'number') return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

function attemptCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Milliseconds until an active lock expires; 0 when not locked. */
export function lockoutRemainingMs(state: PinLockoutState | undefined, nowMs: number): number {
  return Math.max(0, lockedUntilMs(state?.pinLockedUntil) - nowMs);
}

export type FailedAttemptTransition = {
  /** Field updates to persist (null when the account was already locked). */
  update: { pinFailedAttempts: number; pinLockedUntilMs?: number } | null;
  /** When non-null, the caller must respond 429 with this remaining duration. */
  lockedForMs: number | null;
};

/**
 * Transition for one failed PIN attempt at `nowMs`.
 *
 *  - already locked     -> no write, report remaining lock
 *  - Nth failure (N >= MAX_FAILED_ATTEMPTS) -> reset counter, set lock
 *  - earlier failure    -> increment counter
 */
export function applyFailedAttempt(
  state: PinLockoutState | undefined,
  nowMs: number,
): FailedAttemptTransition {
  const remaining = lockoutRemainingMs(state, nowMs);
  if (remaining > 0) {
    return { update: null, lockedForMs: remaining };
  }
  const attempts = attemptCount(state?.pinFailedAttempts) + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    return {
      update: { pinFailedAttempts: 0, pinLockedUntilMs: nowMs + LOCKOUT_MS },
      lockedForMs: LOCKOUT_MS,
    };
  }
  return { update: { pinFailedAttempts: attempts }, lockedForMs: null };
}
