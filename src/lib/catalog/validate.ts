/**
 * Pure validation for catalog products and prices — shared by the admin API (server-authoritative)
 * and unit tests. Returns a list of human-readable errors (empty = valid).
 */
import type { Product, Price, ProductKind, ProductScope, BillingInterval, GrantReset, Currency } from '@/lib/types';
import { isEntitlementComponentKey } from './entitlement-components';

const KINDS: ProductKind[] = ['one_time', 'subscription', 'free'];
const SCOPES: ProductScope[] = ['family', 'child', 'gift'];
const INTERVALS: BillingInterval[] = ['month', 'year'];
const RESETS: GrantReset[] = ['one_time', 'per_period', 'lifetime'];
const CURRENCIES: Currency[] = ['GBP', 'USD', 'EUR'];

export type ProductInput = Partial<Product>;
export type PriceInput = Partial<Price>;

export function validateProduct(p: ProductInput): string[] {
  const errors: string[] = [];

  if (!p.name || !p.name.trim()) errors.push('name is required');
  if (!p.kind || !KINDS.includes(p.kind)) errors.push(`kind must be one of: ${KINDS.join(', ')}`);
  if (!p.scope || !SCOPES.includes(p.scope)) errors.push(`scope must be one of: ${SCOPES.join(', ')}`);

  // Subscriptions need a billing interval; non-subscriptions must not have one.
  if (p.kind === 'subscription') {
    if (!p.interval || !INTERVALS.includes(p.interval)) {
      errors.push(`subscription requires interval: ${INTERVALS.join(' | ')}`);
    }
  } else if (p.interval) {
    errors.push('interval is only valid for subscription products');
  }

  // Grants
  if (!Array.isArray(p.grants) || p.grants.length === 0) {
    errors.push('at least one grant is required');
  } else {
    p.grants.forEach((g, i) => {
      if (!g || !isEntitlementComponentKey(g.component as string)) {
        errors.push(`grant[${i}].component is not a known entitlement component`);
      }
      if (typeof g?.quantity !== 'number' || !Number.isFinite(g.quantity) || g.quantity <= 0) {
        errors.push(`grant[${i}].quantity must be a positive number`);
      }
      if (!g || !RESETS.includes(g.reset)) {
        errors.push(`grant[${i}].reset must be one of: ${RESETS.join(', ')}`);
      }
      // Coherence: per_period only makes sense for subscriptions.
      if (g?.reset === 'per_period' && p.kind !== 'subscription') {
        errors.push(`grant[${i}].reset 'per_period' requires a subscription product`);
      }
    });
  }

  // A printed-book product (links a PrintProduct) should grant a print credit.
  if (p.printProductId && Array.isArray(p.grants) && !p.grants.some((g) => g.component === 'print_credit')) {
    errors.push('a product linked to a PrintProduct should grant print_credit');
  }

  return errors;
}

export function validatePrice(price: PriceInput): string[] {
  const errors: string[] = [];

  if (!price.productId || !price.productId.trim()) errors.push('productId is required');
  if (!price.currency || !CURRENCIES.includes(price.currency)) {
    errors.push(`currency must be one of: ${CURRENCIES.join(', ')}`);
  }
  if (typeof price.amountMinor !== 'number' || !Number.isInteger(price.amountMinor) || price.amountMinor < 0) {
    errors.push('amountMinor must be a non-negative integer (minor units)');
  }
  if (price.interval && !INTERVALS.includes(price.interval)) {
    errors.push(`interval must be one of: ${INTERVALS.join(', ')}`);
  }

  return errors;
}

/** Format a minor-unit amount for display, e.g. (2499,'GBP') -> "£24.99". */
export function formatPrice(amountMinor: number, currency: Currency): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : '€';
  return `${symbol}${(amountMinor / 100).toFixed(2)}`;
}
