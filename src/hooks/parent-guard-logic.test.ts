import { describe, expect, it } from 'vitest';
import { GUARD_TIMEOUT_MS, interpretStoredGuardTimestamp } from './parent-guard-logic';

const NOW = 1_750_000_000_000;

describe('interpretStoredGuardTimestamp', () => {
  it('restores an unexpired timestamp (reload inside the grace window)', () => {
    const validatedAt = NOW - GUARD_TIMEOUT_MS + 30_000; // 30s of grace left
    expect(interpretStoredGuardTimestamp(String(validatedAt), NOW)).toEqual({
      lastValidatedAt: validatedAt,
      shouldClear: false,
    });
  });

  it('returns null without clearing when nothing is stored', () => {
    expect(interpretStoredGuardTimestamp(null, NOW)).toEqual({
      lastValidatedAt: null,
      shouldClear: false,
    });
    expect(interpretStoredGuardTimestamp('', NOW)).toEqual({
      lastValidatedAt: null,
      shouldClear: false,
    });
  });

  it('clears and returns null for garbage values', () => {
    expect(interpretStoredGuardTimestamp('not-a-number', NOW)).toEqual({
      lastValidatedAt: null,
      shouldClear: true,
    });
  });

  it('clears and returns null for an expired timestamp', () => {
    const expiredAt = NOW - GUARD_TIMEOUT_MS; // exactly at the boundary = expired
    expect(interpretStoredGuardTimestamp(String(expiredAt), NOW)).toEqual({
      lastValidatedAt: null,
      shouldClear: true,
    });
    expect(
      interpretStoredGuardTimestamp(String(NOW - GUARD_TIMEOUT_MS - 60_000), NOW),
    ).toEqual({ lastValidatedAt: null, shouldClear: true });
  });

  it('restores a timestamp one millisecond inside the window', () => {
    const justInside = NOW - GUARD_TIMEOUT_MS + 1;
    expect(interpretStoredGuardTimestamp(String(justInside), NOW)).toEqual({
      lastValidatedAt: justInside,
      shouldClear: false,
    });
  });
});
