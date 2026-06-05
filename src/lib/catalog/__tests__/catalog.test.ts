import { describe, it, expect } from 'vitest';
import { validateProduct, validatePrice, formatPrice } from '@/lib/catalog/validate';
import { ENTITLEMENT_COMPONENTS, isEntitlementComponentKey } from '@/lib/catalog/entitlement-components';
import type { Product, Price } from '@/lib/types';

const validSubscription: Partial<Product> = {
  name: 'Family Plan',
  kind: 'subscription',
  scope: 'family',
  interval: 'month',
  grants: [
    { component: 'story_allowance', quantity: 20, reset: 'per_period' },
    { component: 'storybook_allowance', quantity: 40, reset: 'per_period' },
  ],
};

const validBook: Partial<Product> = {
  name: 'Hardcover Book',
  kind: 'one_time',
  scope: 'family',
  printProductId: 'pp_1',
  grants: [{ component: 'print_credit', quantity: 1, reset: 'one_time' }],
};

describe('validateProduct', () => {
  it('accepts a well-formed subscription', () => {
    expect(validateProduct(validSubscription)).toEqual([]);
  });

  it('accepts a well-formed one-time printed book', () => {
    expect(validateProduct(validBook)).toEqual([]);
  });

  it('accepts a free tier with lifetime grants', () => {
    expect(
      validateProduct({
        name: 'Free',
        kind: 'free',
        scope: 'family',
        grants: [
          { component: 'story_allowance', quantity: 1, reset: 'lifetime' },
          { component: 'storybook_allowance', quantity: 2, reset: 'lifetime' },
        ],
      })
    ).toEqual([]);
  });

  it('requires a name, kind, scope and at least one grant', () => {
    const errs = validateProduct({});
    expect(errs).toEqual(expect.arrayContaining([expect.stringMatching(/name/), expect.stringMatching(/grant/)]));
  });

  it('requires an interval for subscriptions', () => {
    expect(validateProduct({ ...validSubscription, interval: null })).toEqual(
      expect.arrayContaining([expect.stringMatching(/subscription requires interval/)])
    );
  });

  it('rejects an interval on non-subscriptions', () => {
    expect(validateProduct({ ...validBook, interval: 'month' })).toEqual(
      expect.arrayContaining([expect.stringMatching(/interval is only valid for subscription/)])
    );
  });

  it('rejects unknown components and non-positive quantities', () => {
    const errs = validateProduct({
      name: 'X', kind: 'free', scope: 'family',
      grants: [{ component: 'nope' as any, quantity: 0, reset: 'lifetime' }],
    });
    expect(errs).toEqual(
      expect.arrayContaining([expect.stringMatching(/not a known entitlement/), expect.stringMatching(/positive number/)])
    );
  });

  it("rejects per_period reset on a non-subscription", () => {
    expect(
      validateProduct({ name: 'X', kind: 'one_time', scope: 'family', grants: [{ component: 'story_allowance', quantity: 1, reset: 'per_period' }] })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/per_period.*subscription/)]));
  });

  it('flags a PrintProduct link without a print_credit grant', () => {
    expect(
      validateProduct({ name: 'X', kind: 'one_time', scope: 'family', printProductId: 'pp_1', grants: [{ component: 'story_allowance', quantity: 1, reset: 'one_time' }] })
    ).toEqual(expect.arrayContaining([expect.stringMatching(/should grant print_credit/)]));
  });
});

describe('validatePrice', () => {
  const valid: Partial<Price> = { productId: 'p1', currency: 'GBP', amountMinor: 2499, interval: 'month' };

  it('accepts a valid price', () => {
    expect(validatePrice(valid)).toEqual([]);
  });
  it('accepts £0 (free)', () => {
    expect(validatePrice({ productId: 'p1', currency: 'GBP', amountMinor: 0 })).toEqual([]);
  });
  it('rejects negative or non-integer amounts', () => {
    expect(validatePrice({ ...valid, amountMinor: -1 })).toEqual(expect.arrayContaining([expect.stringMatching(/non-negative integer/)]));
    expect(validatePrice({ ...valid, amountMinor: 24.99 })).toEqual(expect.arrayContaining([expect.stringMatching(/non-negative integer/)]));
  });
  it('requires productId and currency', () => {
    expect(validatePrice({})).toEqual(expect.arrayContaining([expect.stringMatching(/productId/), expect.stringMatching(/currency/)]));
  });
});

describe('formatPrice', () => {
  it('formats minor units with the right symbol', () => {
    expect(formatPrice(2499, 'GBP')).toBe('£24.99');
    expect(formatPrice(0, 'GBP')).toBe('£0.00');
    expect(formatPrice(500, 'USD')).toBe('$5.00');
    expect(formatPrice(1000, 'EUR')).toBe('€10.00');
  });
});

describe('entitlement components registry', () => {
  it('exposes the expected components', () => {
    expect(Object.keys(ENTITLEMENT_COMPONENTS).sort()).toEqual(['print_credit', 'story_allowance', 'storybook_allowance']);
  });
  it('isEntitlementComponentKey guards correctly', () => {
    expect(isEntitlementComponentKey('print_credit')).toBe(true);
    expect(isEntitlementComponentKey('bogus')).toBe(false);
  });
});
