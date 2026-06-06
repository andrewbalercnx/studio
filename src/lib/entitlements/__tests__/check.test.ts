import { describe, it, expect } from 'vitest';
import { canConsume, consume, remainingInBalances } from '@/lib/entitlements/check';
import type { EntitlementLedger } from '@/lib/types';

function ledger(): EntitlementLedger {
  return {
    parentUid: 'p1',
    family: {
      print_credit: { granted: 2, consumed: 0, balance: 2 },
      story_allowance: { allowance: 5, used: 4, reset: 'per_period' },
    },
    children: {
      c1: {
        story_allowance: { allowance: 3, used: 0, reset: 'per_period' },
      },
    },
  };
}

describe('remainingInBalances', () => {
  it('consumable remaining = balance', () => {
    expect(remainingInBalances({ print_credit: { granted: 5, consumed: 2, balance: 3 } }, 'print_credit')).toBe(3);
  });
  it('quota remaining = allowance - used, floored at 0', () => {
    expect(remainingInBalances({ story_allowance: { allowance: 5, used: 7, reset: 'lifetime' } }, 'story_allowance')).toBe(0);
  });
  it('absent component => 0', () => {
    expect(remainingInBalances({}, 'storybook_allowance')).toBe(0);
    expect(remainingInBalances(undefined, 'print_credit')).toBe(0);
  });
});

describe('canConsume — family-only scope', () => {
  it('allows when family pool has capacity', () => {
    const r = canConsume(ledger(), 'print_credit', { parentUid: 'p1' });
    expect(r).toMatchObject({ allowed: true, source: 'family', remaining: 2 });
  });
  it('denies when family pool is exhausted', () => {
    const r = canConsume(ledger(), 'storybook_allowance', { parentUid: 'p1' });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.reason).toContain('insufficient');
  });
  it('denies a non-positive amount', () => {
    expect(canConsume(ledger(), 'print_credit', { parentUid: 'p1' }, 0).allowed).toBe(false);
  });
});

describe('canConsume — scope resolution (child first, then family)', () => {
  it('uses the child allowance first when the child has capacity', () => {
    const r = canConsume(ledger(), 'story_allowance', { parentUid: 'p1', childId: 'c1' });
    expect(r).toMatchObject({ allowed: true, source: 'child', remaining: 3 });
  });

  it('falls back to the family pool when the child has none of the component', () => {
    const r = canConsume(ledger(), 'print_credit', { parentUid: 'p1', childId: 'c1' });
    expect(r).toMatchObject({ allowed: true, source: 'family', remaining: 2 });
  });

  it('falls back to family when child capacity is exhausted', () => {
    const l = ledger();
    l.children!.c1.story_allowance = { allowance: 3, used: 3, reset: 'per_period' };
    // family story_allowance has 1 remaining (5-4)
    const r = canConsume(l, 'story_allowance', { parentUid: 'p1', childId: 'c1' });
    expect(r).toMatchObject({ allowed: true, source: 'family', remaining: 1 });
  });

  it('denies when neither child nor family can satisfy the amount', () => {
    const l = ledger();
    l.children!.c1.story_allowance = { allowance: 3, used: 3, reset: 'per_period' };
    l.family.story_allowance = { allowance: 5, used: 5, reset: 'per_period' };
    const r = canConsume(l, 'story_allowance', { parentUid: 'p1', childId: 'c1' });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});

describe('consume — decrements correct scope, returns new ledger', () => {
  it('consumes from the child first and does not touch family', () => {
    const l = ledger();
    const r = consume(l, 'story_allowance', { parentUid: 'p1', childId: 'c1' });
    expect(r.allowed).toBe(true);
    expect(r.source).toBe('child');
    expect(r.remaining).toBe(2); // 3 -> used 1
    expect(r.ledger.children!.c1.story_allowance!.used).toBe(1);
    expect(r.ledger.family.story_allowance!.used).toBe(4); // unchanged
    // input not mutated
    expect(l.children!.c1.story_allowance!.used).toBe(0);
  });

  it('consumes a consumable from the family pool', () => {
    const l = ledger();
    const r = consume(l, 'print_credit', { parentUid: 'p1', childId: 'c1' });
    expect(r.source).toBe('family');
    expect(r.remaining).toBe(1);
    expect(r.ledger.family.print_credit).toEqual({ granted: 2, consumed: 1, balance: 1 });
    expect(l.family.print_credit!.balance).toBe(2); // input untouched
  });

  it('falls back to family when child exhausted, decrementing family', () => {
    const l = ledger();
    l.children!.c1.story_allowance = { allowance: 3, used: 3, reset: 'per_period' };
    const r = consume(l, 'story_allowance', { parentUid: 'p1', childId: 'c1' });
    expect(r.source).toBe('family');
    expect(r.ledger.family.story_allowance!.used).toBe(5);
    expect(r.remaining).toBe(0);
  });

  it('returns the unchanged ledger and allowed=false when denied', () => {
    const l = ledger();
    const r = consume(l, 'storybook_allowance', { parentUid: 'p1' });
    expect(r.allowed).toBe(false);
    expect(r.ledger).toBe(l);
  });

  it('respects an amount greater than 1', () => {
    const l = ledger();
    const r = consume(l, 'print_credit', { parentUid: 'p1' }, 2);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.ledger.family.print_credit).toEqual({ granted: 2, consumed: 2, balance: 0 });
  });
});
