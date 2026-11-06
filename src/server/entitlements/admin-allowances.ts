/**
 * Admin allowance management: look a family up, see every balance (family pool
 * and each child's own), and adjust one with a reason.
 *
 * Every change is recorded in `entitlementLedgers/{uid}/grants`, the history a
 * purchase will also write to (`source: 'purchase'`, with the product and price)
 * when payment lands; see docs/PRODUCTS.md. The balances themselves keep the
 * ledger's shape, so story and book creation read them unchanged.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ENTITLEMENT_COMPONENT_LIST, ENTITLEMENT_COMPONENTS } from '@/lib/catalog/entitlement-components';
import { remainingInBalances } from '@/lib/entitlements/check';
import { buildFreeTierLedger, ensureFreeTier } from '@/lib/entitlements/grant';
import type { ConsumableBalance, EntitlementBalances, EntitlementComponentKey, EntitlementLedger, QuotaBalance } from '@/lib/types';
import type { AllowanceAdjustment, AllowanceRow, AllowanceTotals, AllowanceTotalsResponse, FamilyAllowances, GrantRecordView } from '@/lib/entitlements/admin-types';
import { BadRequestError, NotFoundError } from '../errors';

export type { AllowanceAdjustment, AllowanceRow, AllowanceTotals, AllowanceTotalsResponse, FamilyAllowances, GrantRecordView };

const LEDGERS = 'entitlementLedgers';
const HISTORY_LIMIT = 30;

export type AdminAllowanceDeps = {
  db: Firestore;
  /** uid and email for an email address or a uid; null if no such account. */
  findAccount: (emailOrUid: string) => Promise<{ uid: string; email: string | null } | null>;
  now: () => Date;
};

/** One balance as the admin sees it. */
function row(balances: EntitlementBalances | undefined, component: EntitlementComponentKey): AllowanceRow {
  const def = ENTITLEMENT_COMPONENTS[component];
  const raw = balances?.[component];
  if (def.meter === 'consumable') {
    const b = raw as ConsumableBalance | undefined;
    return { component, label: def.label, unit: def.unit, meter: 'consumable', total: b?.granted ?? 0, used: b?.consumed ?? 0, remaining: remainingInBalances(balances, component), present: !!b };
  }
  const q = raw as QuotaBalance | undefined;
  return { component, label: def.label, unit: def.unit, meter: 'quota', total: q?.allowance ?? 0, used: q?.used ?? 0, remaining: remainingInBalances(balances, component), present: !!q, reset: q?.reset };
}

/**
 * Apply one admin adjustment to a balances bucket. Pure.
 * - `add`: change what is available by `quantity` (negative takes away; never below what is used).
 * - `setRemaining`: make exactly `quantity` available from now on.
 * A quota keeps its reset rule and window; a new quota starts as `lifetime`.
 */
export function adjustBalances(balances: EntitlementBalances, adjustment: Pick<AllowanceAdjustment, 'component' | 'mode' | 'quantity'>): EntitlementBalances {
  const { component, mode, quantity } = adjustment;
  const next: EntitlementBalances = { ...balances };
  if (ENTITLEMENT_COMPONENTS[component].meter === 'consumable') {
    const b = (balances[component] as ConsumableBalance | undefined) ?? { granted: 0, consumed: 0, balance: 0 };
    const balance = Math.max(0, mode === 'add' ? b.balance + quantity : quantity);
    (next as Record<string, unknown>)[component] = { granted: b.consumed + balance, consumed: b.consumed, balance } satisfies ConsumableBalance;
    return next;
  }
  const q = (balances[component] as QuotaBalance | undefined) ?? { allowance: 0, used: 0, reset: 'lifetime' as const };
  const remaining = Math.max(0, mode === 'add' ? q.allowance - q.used + quantity : quantity);
  (next as Record<string, unknown>)[component] = { ...q, allowance: q.used + remaining } satisfies QuotaBalance;
  return next;
}

async function loadView(deps: AdminAllowanceDeps, uid: string, email: string | null): Promise<FamilyAllowances> {
  const [ledgerSnap, childSnap, historySnap] = await Promise.all([
    deps.db.collection(LEDGERS).doc(uid).get(),
    deps.db.collection('children').where('ownerUid', '==', uid).get(),
    // A family's history is short: sorted here, so no index is needed.
    deps.db.collection(LEDGERS).doc(uid).collection('grants').get(),
  ]);
  // A family that never made anything has no ledger yet: show what it would start with.
  const ledger = ledgerSnap.exists ? ensureFreeTier({ parentUid: uid, ...ledgerSnap.data() } as EntitlementLedger, deps.now()) : buildFreeTierLedger(uid, deps.now());
  const children = childSnap.docs
    .filter((d) => !d.data().deletedAt)
    .map((d) => ({
      childId: d.id,
      displayName: (d.data().displayName as string) ?? d.id,
      rows: ENTITLEMENT_COMPONENT_LIST.map((c) => row(ledger.children?.[d.id], c.key)),
    }));
  return {
    uid,
    email,
    ledgerExists: ledgerSnap.exists,
    family: ENTITLEMENT_COMPONENT_LIST.map((c) => row(ledger.family, c.key)),
    children,
    history: [...historySnap.docs]
      .sort((a, b) => (b.data().at?.toMillis?.() ?? 0) - (a.data().at?.toMillis?.() ?? 0))
      .slice(0, HISTORY_LIMIT)
      .map((d) => {
      const g = d.data();
      return {
        id: d.id,
        at: typeof g.at?.toDate === 'function' ? g.at.toDate().toISOString() : null,
        source: g.source,
        by: g.byEmail ?? g.byUid ?? null,
        scope: g.childId ? `child:${g.childName ?? g.childId}` : 'family',
        component: g.component,
        mode: g.mode,
        quantity: g.quantity,
        remainingBefore: g.remainingBefore,
        remainingAfter: g.remainingAfter,
        reason: g.reason ?? '',
      };
    }),
  };
}

export async function getFamilyAllowances(deps: AdminAllowanceDeps, emailOrUid: string): Promise<FamilyAllowances> {
  const account = await deps.findAccount(emailOrUid.trim());
  if (!account) throw new NotFoundError(`No account for ${emailOrUid}`, { code: 'ACCOUNT_NOT_FOUND' });
  return loadView(deps, account.uid, account.email);
}

export async function adjustAllowance(
  deps: AdminAllowanceDeps,
  admin: { uid: string; email: string | null },
  adjustment: AllowanceAdjustment
): Promise<FamilyAllowances> {
  const { uid, childId, component, mode, quantity, reason } = adjustment;
  if (!Number.isInteger(quantity)) throw new BadRequestError('quantity must be a whole number', { code: 'INVALID_QUANTITY' });
  if (mode === 'setRemaining' && quantity < 0) throw new BadRequestError('remaining cannot be negative', { code: 'INVALID_QUANTITY' });

  let childName: string | null = null;
  if (childId) {
    const child = await deps.db.collection('children').doc(childId).get();
    if (!child.exists || child.data()?.ownerUid !== uid) throw new NotFoundError('That child is not in this family', { code: 'CHILD_NOT_FOUND' });
    childName = (child.data()?.displayName as string) ?? null;
  }

  const ledgerRef = deps.db.collection(LEDGERS).doc(uid);
  const grantRef = ledgerRef.collection('grants').doc();
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    const now = deps.now();
    const ledger = snap.exists ? ensureFreeTier({ parentUid: uid, ...snap.data() } as EntitlementLedger, now) : buildFreeTierLedger(uid, now);
    const before = childId ? ledger.children?.[childId] ?? {} : ledger.family ?? {};
    const after = adjustBalances(before, { component, mode, quantity });
    const update: Record<string, unknown> = {
      freeTierGranted: true,
      family: childId ? ledger.family : after,
      children: childId ? { ...(ledger.children ?? {}), [childId]: after } : ledger.children ?? {},
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };
    tx.set(ledgerRef, update, { merge: true });
    tx.set(grantRef, {
      source: 'admin',
      byUid: admin.uid,
      byEmail: admin.email,
      childId: childId ?? null,
      childName,
      component,
      mode,
      quantity,
      remainingBefore: remainingInBalances(before, component),
      remainingAfter: remainingInBalances(after, component),
      reason,
      at: FieldValue.serverTimestamp(),
    });
  });
  const account = await deps.findAccount(uid);
  return loadView(deps, uid, account?.email ?? null);
}

/** What is left, family pool plus every child's own balance. */
function leftIn(ledger: EntitlementLedger): AllowanceTotals {
  const scopes = [ledger.family, ...Object.values(ledger.children ?? {})];
  const sum = (component: EntitlementComponentKey) => scopes.reduce((n, b) => n + remainingInBalances(b, component), 0);
  return { stories: sum('story_allowance'), books: sum('storybook_allowance') };
}

/**
 * Stories and books left for every family with a ledger, for the admin Users
 * list; a family without one has the free tier (`freeTier`).
 */
export async function allowanceTotals(db: Firestore, now: Date): Promise<AllowanceTotalsResponse> {
  const snap = await db.collection(LEDGERS).get();
  const byUid: Record<string, AllowanceTotals> = {};
  for (const doc of snap.docs) {
    byUid[doc.id] = leftIn(ensureFreeTier({ parentUid: doc.id, ...doc.data() } as EntitlementLedger, now));
  }
  return { byUid, freeTier: leftIn(buildFreeTierLedger('free-tier', now)) };
}

