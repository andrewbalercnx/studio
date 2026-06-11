import { describe, expect, it } from 'vitest';
import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  applyFailedAttempt,
  lockoutRemainingMs,
} from './pin-lockout';

const NOW = 1_750_000_000_000;

describe('lockoutRemainingMs', () => {
  it('returns 0 when no lock state exists', () => {
    expect(lockoutRemainingMs(undefined, NOW)).toBe(0);
    expect(lockoutRemainingMs({}, NOW)).toBe(0);
    expect(lockoutRemainingMs({ pinLockedUntil: null }, NOW)).toBe(0);
  });

  it('returns the remaining duration for an active lock (number or Timestamp-like)', () => {
    expect(lockoutRemainingMs({ pinLockedUntil: NOW + 90_000 }, NOW)).toBe(90_000);
    expect(
      lockoutRemainingMs({ pinLockedUntil: { toMillis: () => NOW + 45_000 } }, NOW),
    ).toBe(45_000);
  });

  it('returns 0 for an expired lock', () => {
    expect(lockoutRemainingMs({ pinLockedUntil: NOW - 1 }, NOW)).toBe(0);
  });
});

describe('applyFailedAttempt (state machine)', () => {
  it('increments the counter on early failures without locking', () => {
    let state: { pinFailedAttempts?: number } = {};
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      const t = applyFailedAttempt(state, NOW);
      expect(t.lockedForMs).toBeNull();
      expect(t.update).toEqual({ pinFailedAttempts: i });
      state = { pinFailedAttempts: t.update!.pinFailedAttempts };
    }
  });

  it(`locks on the ${MAX_FAILED_ATTEMPTS}th consecutive failure and resets the counter`, () => {
    const t = applyFailedAttempt({ pinFailedAttempts: MAX_FAILED_ATTEMPTS - 1 }, NOW);
    expect(t.lockedForMs).toBe(LOCKOUT_MS);
    expect(t.update).toEqual({ pinFailedAttempts: 0, pinLockedUntilMs: NOW + LOCKOUT_MS });
  });

  it('reports the remaining lock without writing while already locked', () => {
    const t = applyFailedAttempt(
      { pinFailedAttempts: 0, pinLockedUntil: NOW + 120_000 },
      NOW,
    );
    expect(t.update).toBeNull();
    expect(t.lockedForMs).toBe(120_000);
  });

  it('grants a fresh window after the lock expires', () => {
    const afterExpiry = NOW + LOCKOUT_MS + 1;
    const t = applyFailedAttempt(
      { pinFailedAttempts: 0, pinLockedUntil: NOW + LOCKOUT_MS },
      afterExpiry,
    );
    expect(t.lockedForMs).toBeNull();
    expect(t.update).toEqual({ pinFailedAttempts: 1 });
  });

  it('treats junk attempt counts as zero', () => {
    for (const junk of [undefined, null, 'five', -3, NaN, Infinity]) {
      const t = applyFailedAttempt({ pinFailedAttempts: junk as any }, NOW);
      expect(t.update).toEqual({ pinFailedAttempts: 1 });
      expect(t.lockedForMs).toBeNull();
    }
  });
});
