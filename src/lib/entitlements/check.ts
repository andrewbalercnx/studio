/**
 * Pure check/consume logic for the entitlement ledger. No Firestore — operates on an in-memory
 * ledger and returns an allow/deny decision plus remaining balance (and, on consume, a new ledger).
 *
 * Scope resolution (agreed default, docs/PRODUCTS.md §"Scope resolution"):
 *   when a childId is supplied, draw from the CHILD's own allowance first; if the child has no
 *   capacity for the component, fall back to the FAMILY pool. When no childId is supplied, only the
 *   family pool is considered.
 */
import type {
  ConsumableBalance,
  EntitlementBalances,
  EntitlementCheck,
  EntitlementComponentKey,
  EntitlementLedger,
  LedgerScope,
  EntitlementScope,
  QuotaBalance,
} from '@/lib/types';
import { ENTITLEMENT_COMPONENTS } from '@/lib/catalog/entitlement-components';

/** Writable view for dynamic (keyed-by-union) assignment into a balances bucket. */
type WritableBalances = Record<EntitlementComponentKey, ConsumableBalance | QuotaBalance | undefined>;

/** Remaining redeemable units of a component within a single balances bucket. 0 if absent. */
export function remainingInBalances(
  balances: EntitlementBalances | undefined,
  component: EntitlementComponentKey,
): number {
  if (!balances) return 0;
  const def = ENTITLEMENT_COMPONENTS[component];
  if (def.meter === 'consumable') {
    const b = balances[component] as { balance: number } | undefined;
    return b ? Math.max(0, b.balance) : 0;
  }
  const q = balances[component] as { allowance: number; used: number } | undefined;
  return q ? Math.max(0, q.allowance - q.used) : 0;
}

/**
 * Decrement `amount` of a component within a balances bucket, returning a new bucket.
 * Assumes capacity has already been checked (caller guarantees remaining >= amount).
 */
function consumeFromBalances(
  balances: EntitlementBalances,
  component: EntitlementComponentKey,
  amount: number,
): EntitlementBalances {
  const def = ENTITLEMENT_COMPONENTS[component];
  const next: WritableBalances = { ...balances } as WritableBalances;
  if (def.meter === 'consumable') {
    const b = balances[component] as ConsumableBalance;
    next[component] = {
      granted: b.granted,
      consumed: b.consumed + amount,
      balance: b.balance - amount,
    };
  } else {
    const q = balances[component] as QuotaBalance;
    next[component] = { ...q, used: q.used + amount };
  }
  return next as EntitlementBalances;
}

/** Order in which scopes are consulted given a LedgerScope. Child first, then family. */
function resolveScopeOrder(scope: LedgerScope): EntitlementScope[] {
  return scope.childId ? ['child', 'family'] : ['family'];
}

function balancesForScope(
  ledger: EntitlementLedger,
  which: EntitlementScope,
  childId?: string,
): EntitlementBalances | undefined {
  if (which === 'family') return ledger.family;
  return childId ? ledger.children?.[childId] : undefined;
}

/**
 * Non-mutating check: can `amount` (default 1) of `component` be consumed under this scope?
 * Returns allowed + which scope would satisfy it + remaining in that scope.
 */
export function canConsume(
  ledger: EntitlementLedger,
  component: EntitlementComponentKey,
  scope: LedgerScope,
  amount = 1,
): EntitlementCheck {
  if (amount <= 0) {
    return { allowed: false, remaining: 0, reason: 'amount must be positive' };
  }
  for (const which of resolveScopeOrder(scope)) {
    const remaining = remainingInBalances(
      balancesForScope(ledger, which, scope.childId),
      component,
    );
    if (remaining >= amount) {
      return { allowed: true, remaining, source: which };
    }
  }
  // Denied — report the best remaining we found (family is the broadest fallback).
  const familyRemaining = remainingInBalances(ledger.family, component);
  const childRemaining = scope.childId
    ? remainingInBalances(ledger.children?.[scope.childId], component)
    : 0;
  return {
    allowed: false,
    remaining: Math.max(familyRemaining, childRemaining),
    reason: `insufficient ${component}: need ${amount}, have ${Math.max(
      familyRemaining,
      childRemaining,
    )}`,
  };
}

/**
 * Consume `amount` (default 1) of `component` under this scope, applying scope resolution
 * (child first, then family). Returns the decision and, when allowed, the updated ledger.
 * Pure: the input ledger is not mutated; persistence is the caller's job.
 */
export function consume(
  ledger: EntitlementLedger,
  component: EntitlementComponentKey,
  scope: LedgerScope,
  amount = 1,
): EntitlementCheck & { ledger: EntitlementLedger } {
  const check = canConsume(ledger, component, scope, amount);
  if (!check.allowed || !check.source) {
    return { ...check, ledger };
  }

  const which = check.source;
  if (which === 'child') {
    const childId = scope.childId as string;
    const childBalances = ledger.children?.[childId] ?? {};
    const updatedChild = consumeFromBalances(childBalances, component, amount);
    const nextLedger: EntitlementLedger = {
      ...ledger,
      children: { ...(ledger.children ?? {}), [childId]: updatedChild },
    };
    return {
      allowed: true,
      remaining: remainingInBalances(updatedChild, component),
      source: 'child',
      ledger: nextLedger,
    };
  }

  const updatedFamily = consumeFromBalances(ledger.family ?? {}, component, amount);
  const nextLedger: EntitlementLedger = { ...ledger, family: updatedFamily };
  return {
    allowed: true,
    remaining: remainingInBalances(updatedFamily, component),
    source: 'family',
    ledger: nextLedger,
  };
}
