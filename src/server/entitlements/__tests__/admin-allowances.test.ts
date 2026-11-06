import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { adjustAllowance, adjustBalances, getFamilyAllowances, type AdminAllowanceDeps } from '../admin-allowances';

const admin = { uid: 'a1', email: 'admin@example.com' };

function setup() {
  const fake = new FakeFirestore();
  fake.store.set('children/c1', { ownerUid: 'p1', displayName: 'Emma' });
  fake.store.set('children/x', { ownerUid: 'p2', displayName: 'Other' });
  fake.store.set('entitlementLedgers/p1', {
    family: { story_allowance: { allowance: 1, used: 1, reset: 'lifetime' }, storybook_allowance: { allowance: 2, used: 1, reset: 'lifetime' } },
    children: {},
    freeTierGranted: true,
  });
  const deps: AdminAllowanceDeps = {
    db: fake.asFirestore(),
    findAccount: async (q) => (q === 'p1' || q === 'parent@example.com' ? { uid: 'p1', email: 'parent@example.com' } : q === 'p3' ? { uid: 'p3', email: null } : null),
    now: () => new Date('2026-11-02T10:00:00Z'),
  };
  return { fake, deps };
}

const remaining = (rows: Array<{ component: string; remaining: number }>, component: string) => rows.find((r) => r.component === component)!.remaining;

describe('adjustBalances', () => {
  it('adds to (or takes from) what is left, never below what is used, and keeps the reset rule', () => {
    const q = { story_allowance: { allowance: 3, used: 2, reset: 'per_period' as const, periodStart: 'p' } };
    expect(adjustBalances(q, { component: 'story_allowance', mode: 'add', quantity: 5 }).story_allowance).toEqual({ allowance: 8, used: 2, reset: 'per_period', periodStart: 'p' });
    expect(adjustBalances(q, { component: 'story_allowance', mode: 'add', quantity: -9 }).story_allowance).toMatchObject({ allowance: 2, used: 2 });
    expect(adjustBalances(q, { component: 'story_allowance', mode: 'setRemaining', quantity: 10 }).story_allowance).toMatchObject({ allowance: 12, used: 2 });
  });

  it('handles consumables and missing balances', () => {
    expect(adjustBalances({}, { component: 'print_credit', mode: 'add', quantity: 2 }).print_credit).toEqual({ granted: 2, consumed: 0, balance: 2 });
    expect(adjustBalances({}, { component: 'storybook_allowance', mode: 'setRemaining', quantity: 4 }).storybook_allowance).toEqual({ allowance: 4, used: 0, reset: 'lifetime' });
  });
});

describe('admin allowances', () => {
  it("shows a family's balances by email, with each child, and 404s an unknown account", async () => {
    const { deps } = setup();
    const view = await getFamilyAllowances(deps, 'parent@example.com');
    expect(view.uid).toBe('p1');
    expect(remaining(view.family, 'story_allowance')).toBe(0);
    expect(remaining(view.family, 'storybook_allowance')).toBe(1);
    expect(view.children.map((c) => c.displayName)).toEqual(['Emma']);
    await expect(getFamilyAllowances(deps, 'nobody@example.com')).rejects.toMatchObject({ status: 404 });
  });

  it('a family with no ledger yet shows the free tier it starts with', async () => {
    const { deps } = setup();
    const view = await getFamilyAllowances(deps, 'p3');
    expect(view.ledgerExists).toBe(false);
    expect(remaining(view.family, 'story_allowance')).toBe(1);
  });

  it('adjusts the family pool or a child, and records who, what and why', async () => {
    const { deps, fake } = setup();
    let view = await adjustAllowance(deps, admin, { uid: 'p1', component: 'story_allowance', mode: 'add', quantity: 10, reason: 'testing' });
    expect(remaining(view.family, 'story_allowance')).toBe(10);
    view = await adjustAllowance(deps, admin, { uid: 'p1', childId: 'c1', component: 'storybook_allowance', mode: 'setRemaining', quantity: 3, reason: 'gift' });
    expect(remaining(view.children[0].rows, 'storybook_allowance')).toBe(3);
    expect(remaining(view.family, 'storybook_allowance')).toBe(1);
    expect(view.history.map((h) => [h.scope, h.component, h.remainingBefore, h.remainingAfter, h.by, h.reason])).toEqual(
      expect.arrayContaining([
        ['family', 'story_allowance', 0, 10, 'admin@example.com', 'testing'],
        ['child:Emma', 'storybook_allowance', 0, 3, 'admin@example.com', 'gift'],
      ])
    );
    expect(fake.store.get('entitlementLedgers/p1')).toMatchObject({ family: { story_allowance: { allowance: 11, used: 1 } } });
  });

  it("refuses another family's child", async () => {
    const { deps } = setup();
    await expect(adjustAllowance(deps, admin, { uid: 'p1', childId: 'x', component: 'story_allowance', mode: 'add', quantity: 1, reason: 'nope' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('allowanceTotals', () => {
  it("sums each family's pool and children's own balances, with the free tier for families without a ledger", async () => {
    const { deps, fake } = setup();
    fake.store.set('entitlementLedgers/p9', {
      family: { story_allowance: { allowance: 5, used: 2, reset: 'lifetime' } },
      children: { k1: { story_allowance: { allowance: 3, used: 0, reset: 'lifetime' }, storybook_allowance: { allowance: 1, used: 1, reset: 'lifetime' } } },
      freeTierGranted: true,
    });
    const { allowanceTotals } = await import('../admin-allowances');
    const totals = await allowanceTotals(deps.db, deps.now());
    expect(totals.byUid.p1).toEqual({ stories: 0, books: 1 });
    expect(totals.byUid.p9).toEqual({ stories: 6, books: 0 });
    expect(totals.freeTier).toEqual({ stories: 1, books: 2 });
  });
});
