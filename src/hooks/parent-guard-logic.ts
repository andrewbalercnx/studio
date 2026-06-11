/**
 * Pure decision logic for the parent PIN guard (unit-tested; no React).
 *
 * The guard persists its last successful validation in
 * sessionStorage["storypic.parentGuard.lastValidatedAt:<uid>"]. On mount the
 * provider hydrates that value; a hard reload INSIDE the unexpired window must
 * restore the validated state without re-prompting (probe finding
 * `pin-guard--grace-lost-on-full-reload`). Consumers must therefore wait for
 * hydration before deciding to open the PIN modal — see useParentGuard's
 * `isGuardHydrated` and components/parent/parent-guard.tsx.
 */

export const GUARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export type GuardHydrationResult = {
  /** Restored validation timestamp, or null when absent/invalid/expired. */
  lastValidatedAt: number | null;
  /** True when the stored value is garbage or expired and should be removed. */
  shouldClear: boolean;
};

export function interpretStoredGuardTimestamp(
  storedValue: string | null,
  nowMs: number,
  timeoutMs: number = GUARD_TIMEOUT_MS,
): GuardHydrationResult {
  if (storedValue === null || storedValue === '') {
    return { lastValidatedAt: null, shouldClear: false };
  }
  const parsed = Number(storedValue);
  if (Number.isNaN(parsed)) {
    return { lastValidatedAt: null, shouldClear: true };
  }
  const isExpired = nowMs - parsed >= timeoutMs;
  if (isExpired) {
    return { lastValidatedAt: null, shouldClear: true };
  }
  return { lastValidatedAt: parsed, shouldClear: false };
}
