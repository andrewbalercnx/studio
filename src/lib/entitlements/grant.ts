/**
 * Pure granting logic for the entitlement ledger. No Firestore here — these functions take a
 * ledger (or a balances bucket) and return a new, updated copy so they are trivially unit-testable
 * and safe to reuse across purchase / free-tier / manual grant flows. See docs/PRODUCTS.md.
 *
 * Granting rules per component meter:
 *  - consumable (print_credit): top up — add quantity to `granted` and `balance` (cumulative).
 *  - quota (story_allowance, storybook_allowance): set/refresh the allowance per reset rule:
 *      • one_time / lifetime: add to the allowance, leave `used` as-is (cumulative cap).
 *      • per_period: replace the allowance for the new window and reset `used` to 0, stamping
 *        the period start. The caller supplies `periodStart` (defaults to now) so the pure
 *        function stays deterministic in tests.
 */
import type {
  EntitlementBalances,
  EntitlementLedger,
  ProductGrant,
  Product,
  ConsumableBalance,
  QuotaBalance,
  EntitlementComponentKey,
} from '@/lib/types';
import { ENTITLEMENT_COMPONENTS } from '@/lib/catalog/entitlement-components';

/** Writable view for dynamic (keyed-by-union) assignment into a balances bucket. */
type WritableBalances = Record<EntitlementComponentKey, ConsumableBalance | QuotaBalance | undefined>;

/** Free-tier defaults (matches docs/PRODUCTS.md example: 1 story ever, 2 storybooks ever). */
export const FREE_TIER_GRANTS: ProductGrant[] = [
  { component: 'story_allowance', quantity: 1, reset: 'lifetime' },
  { component: 'storybook_allowance', quantity: 2, reset: 'lifetime' },
];

/** An empty balances bucket. */
export function emptyBalances(): EntitlementBalances {
  return {};
}

/** Deep-ish clone of a balances bucket (each balance object is a fresh copy). */
function cloneBalances(b: EntitlementBalances | undefined): EntitlementBalances {
  if (!b) return {};
  const out: EntitlementBalances = {};
  if (b.print_credit) out.print_credit = { ...b.print_credit };
  if (b.story_allowance) out.story_allowance = { ...b.story_allowance };
  if (b.storybook_allowance) out.storybook_allowance = { ...b.storybook_allowance };
  return out;
}

/**
 * Apply a single grant to a balances bucket, returning a new bucket. Pure.
 * `now` is used as periodStart for per_period quotas (defaults to a fresh Date).
 */
export function applyGrantToBalances(
  balances: EntitlementBalances,
  grant: ProductGrant,
  now: Date = new Date(),
): EntitlementBalances {
  const next = cloneBalances(balances) as WritableBalances;
  const def = ENTITLEMENT_COMPONENTS[grant.component];
  const qty = grant.quantity;

  if (def.meter === 'consumable') {
    const existing = (next[grant.component] as ConsumableBalance | undefined) ?? {
      granted: 0,
      consumed: 0,
      balance: 0,
    };
    next[grant.component] = {
      granted: existing.granted + qty,
      consumed: existing.consumed,
      balance: existing.balance + qty,
    };
    return next as EntitlementBalances;
  }

  // quota meter (story_allowance / storybook_allowance)
  const existing = next[grant.component] as QuotaBalance | undefined;

  if (grant.reset === 'per_period') {
    // New billing window: replace the allowance and reset usage.
    next[grant.component] = {
      allowance: qty,
      used: 0,
      reset: 'per_period',
      periodStart: now,
    };
  } else {
    // one_time / lifetime: cumulative cap, preserve prior usage.
    next[grant.component] = {
      allowance: (existing?.allowance ?? 0) + qty,
      used: existing?.used ?? 0,
      reset: grant.reset,
      ...(existing?.periodStart ? { periodStart: existing.periodStart } : {}),
    };
  }
  return next as EntitlementBalances;
}

/** Apply a list of grants to a balances bucket, returning a new bucket. Pure. */
export function applyGrantsToBalances(
  balances: EntitlementBalances,
  grants: ProductGrant[],
  now: Date = new Date(),
): EntitlementBalances {
  return grants.reduce((acc, g) => applyGrantToBalances(acc, g, now), cloneBalances(balances));
}

/**
 * Apply a product's grants to a ledger at the correct scope, returning a new ledger. Pure.
 *
 * Scope rules:
 *  - product.scope === 'child' AND a childId is supplied  -> grant into that child's bucket.
 *  - otherwise (family, gift, or child with no childId)   -> grant into the family pool.
 *
 * `gift` is modelled as family-pool here; the purchaser→recipient redemption flow is phase 2
 * (see docs/PRODUCTS.md) and will decide the target ledger at redemption time.
 */
export function applyProductGrants(
  ledger: EntitlementLedger,
  product: Pick<Product, 'scope' | 'grants'>,
  opts: { childId?: string; now?: Date } = {},
): EntitlementLedger {
  const now = opts.now ?? new Date();
  const toChild = product.scope === 'child' && !!opts.childId;

  if (toChild) {
    const childId = opts.childId as string;
    const children = { ...(ledger.children ?? {}) };
    children[childId] = applyGrantsToBalances(children[childId] ?? {}, product.grants, now);
    return { ...ledger, children };
  }

  return {
    ...ledger,
    family: applyGrantsToBalances(ledger.family ?? {}, product.grants, now),
  };
}

/** Build a fresh, free-tier-seeded ledger for a family. Pure. */
export function buildFreeTierLedger(parentUid: string, now: Date = new Date()): EntitlementLedger {
  return {
    parentUid,
    family: applyGrantsToBalances({}, FREE_TIER_GRANTS, now),
    children: {},
    freeTierGranted: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Ensure a ledger has the free-tier grant applied exactly once. Returns a new ledger if seeding
 * happened, or the same reference if it was already seeded. Pure (caller persists the result).
 */
export function ensureFreeTier(
  ledger: EntitlementLedger,
  now: Date = new Date(),
): EntitlementLedger {
  if (ledger.freeTierGranted) return ledger;
  return {
    ...ledger,
    family: applyGrantsToBalances(ledger.family ?? {}, FREE_TIER_GRANTS, now),
    freeTierGranted: true,
    updatedAt: now,
  };
}
