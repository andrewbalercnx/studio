import { describe, it, expect } from 'vitest';
import {
  applyGrantToBalances,
  applyGrantsToBalances,
  applyProductGrants,
  buildFreeTierLedger,
  ensureFreeTier,
  FREE_TIER_GRANTS,
  emptyBalances,
} from '@/lib/entitlements/grant';
import type { EntitlementLedger, ProductGrant } from '@/lib/types';

const NOW = new Date('2026-06-06T00:00:00Z');

describe('applyGrantToBalances — consumables', () => {
  it('tops up a print_credit from empty', () => {
    const out = applyGrantToBalances(emptyBalances(), {
      component: 'print_credit',
      quantity: 1,
      reset: 'one_time',
    });
    expect(out.print_credit).toEqual({ granted: 1, consumed: 0, balance: 1 });
  });

  it('accumulates consumable grants and preserves prior consumption', () => {
    const start = { print_credit: { granted: 2, consumed: 1, balance: 1 } };
    const out = applyGrantToBalances(start, {
      component: 'print_credit',
      quantity: 3,
      reset: 'one_time',
    });
    expect(out.print_credit).toEqual({ granted: 5, consumed: 1, balance: 4 });
  });

  it('does not mutate the input bucket', () => {
    const start = emptyBalances();
    applyGrantToBalances(start, { component: 'print_credit', quantity: 1, reset: 'one_time' });
    expect(start.print_credit).toBeUndefined();
  });
});

describe('applyGrantToBalances — quotas', () => {
  it('lifetime quota is cumulative and preserves used', () => {
    const start = { story_allowance: { allowance: 1, used: 1, reset: 'lifetime' as const } };
    const out = applyGrantToBalances(start, {
      component: 'story_allowance',
      quantity: 2,
      reset: 'lifetime',
    });
    expect(out.story_allowance).toEqual({ allowance: 3, used: 1, reset: 'lifetime' });
  });

  it('per_period quota replaces allowance and resets usage, stamping periodStart', () => {
    const start = {
      story_allowance: { allowance: 20, used: 17, reset: 'per_period' as const, periodStart: new Date('2026-05-06') },
    };
    const out = applyGrantToBalances(
      start,
      { component: 'story_allowance', quantity: 20, reset: 'per_period' },
      NOW,
    );
    expect(out.story_allowance).toEqual({
      allowance: 20,
      used: 0,
      reset: 'per_period',
      periodStart: NOW,
    });
  });
});

describe('applyGrantsToBalances', () => {
  it('applies multiple grants in order', () => {
    const grants: ProductGrant[] = [
      { component: 'story_allowance', quantity: 1, reset: 'lifetime' },
      { component: 'storybook_allowance', quantity: 2, reset: 'lifetime' },
    ];
    const out = applyGrantsToBalances({}, grants);
    expect(out.story_allowance?.allowance).toBe(1);
    expect(out.storybook_allowance?.allowance).toBe(2);
  });
});

describe('applyProductGrants — scope routing', () => {
  const base: EntitlementLedger = { parentUid: 'p1', family: {}, children: {} };

  it('routes child-scoped product to the child bucket when childId given', () => {
    const out = applyProductGrants(
      base,
      { scope: 'child', grants: [{ component: 'story_allowance', quantity: 5, reset: 'per_period' }] },
      { childId: 'c1', now: NOW },
    );
    expect(out.children?.c1?.story_allowance?.allowance).toBe(5);
    expect(out.family.story_allowance).toBeUndefined();
  });

  it('routes child-scoped product to family when no childId supplied', () => {
    const out = applyProductGrants(base, {
      scope: 'child',
      grants: [{ component: 'story_allowance', quantity: 5, reset: 'per_period' }],
    });
    expect(out.family.story_allowance?.allowance).toBe(5);
  });

  it('routes family- and gift-scoped products to the family pool', () => {
    const fam = applyProductGrants(base, {
      scope: 'family',
      grants: [{ component: 'print_credit', quantity: 1, reset: 'one_time' }],
    });
    expect(fam.family.print_credit?.balance).toBe(1);

    const gift = applyProductGrants(base, {
      scope: 'gift',
      grants: [{ component: 'print_credit', quantity: 1, reset: 'one_time' }],
    });
    expect(gift.family.print_credit?.balance).toBe(1);
  });
});

describe('free tier', () => {
  it('buildFreeTierLedger seeds the documented defaults (1 story, 2 storybooks)', () => {
    const ledger = buildFreeTierLedger('p1', NOW);
    expect(ledger.freeTierGranted).toBe(true);
    expect(ledger.family.story_allowance?.allowance).toBe(1);
    expect(ledger.family.storybook_allowance?.allowance).toBe(2);
  });

  it('FREE_TIER_GRANTS use lifetime reset', () => {
    expect(FREE_TIER_GRANTS.every((g) => g.reset === 'lifetime')).toBe(true);
  });

  it('ensureFreeTier is idempotent — does not double-grant', () => {
    const seeded = buildFreeTierLedger('p1', NOW);
    const again = ensureFreeTier(seeded, NOW);
    expect(again).toBe(seeded); // same reference, no work done
    expect(again.family.story_allowance?.allowance).toBe(1);
  });

  it('ensureFreeTier seeds an un-seeded ledger', () => {
    const bare: EntitlementLedger = { parentUid: 'p1', family: {} };
    const out = ensureFreeTier(bare, NOW);
    expect(out.freeTierGranted).toBe(true);
    expect(out.family.story_allowance?.allowance).toBe(1);
    expect(out.family.storybook_allowance?.allowance).toBe(2);
  });
});
