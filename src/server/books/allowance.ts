/**
 * Book allowance, charged inside the transaction that creates the Book
 * (pipeline.md "Book": "Creation charges the book allowance in the same
 * transaction"), so a Book exists if and only if one `storybook_allowance` unit
 * was consumed.
 *
 * Same ledger semantics as src/lib/entitlements/ledger.server.ts
 * `consumeEntitlement` (free tier seeded on first use; child pool first, then
 * the family pool), using its pure helpers; only the read and the write go
 * through the caller's transaction instead of a transaction of their own.
 */
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { canConsume, consume } from '@/lib/entitlements/check';
import { buildFreeTierLedger, ensureFreeTier } from '@/lib/entitlements/grant';
import type { EntitlementComponentKey, EntitlementLedger } from '@/lib/types';

export const LEDGERS_COLLECTION = 'entitlementLedgers';

export type AllowanceCharge =
  | { allowed: true; remaining: number; source: 'child' | 'family'; write: () => void }
  | { allowed: false; remaining: number; reason: string };

/** Read the family's ledger in `tx` (a read: call it before any write). */
export async function readLedgerIn(tx: Transaction, db: Firestore, ownerUid: string) {
  const ref = db.collection(LEDGERS_COLLECTION).doc(ownerUid);
  const snapshot = await tx.get(ref);
  const stored = snapshot.exists ? ({ parentUid: ownerUid, ...snapshot.data() } as EntitlementLedger) : null;
  return { ref, stored };
}

/** Decide one `storybook_allowance` unit; `write()` records it in the same transaction. */
export function chargeBookAllowance(
  tx: Transaction,
  ledger: { ref: DocumentReference; stored: EntitlementLedger | null },
  ownerUid: string,
  childId: string | null,
  now: Date = new Date()
): AllowanceCharge {
  return chargeAllowance(tx, ledger, 'storybook_allowance', ownerUid, childId, now);
}

/**
 * Decide one unit of `component` (child pool first, then the family pool);
 * `write()` records it in the caller's transaction. Used for books here and for
 * the story allowance by `story.finish` (slice 5.3).
 */
export function chargeAllowance(
  tx: Transaction,
  ledger: { ref: DocumentReference; stored: EntitlementLedger | null },
  component: EntitlementComponentKey,
  ownerUid: string,
  childId: string | null,
  now: Date = new Date(),
  amount = 1
): AllowanceCharge {
  const ensured = ledger.stored ? ensureFreeTier(ledger.stored, now) : buildFreeTierLedger(ownerUid, now);
  const result = consume(ensured, component, { parentUid: ownerUid, childId: childId ?? undefined }, amount);
  if (!result.allowed) {
    return { allowed: false, remaining: result.remaining, reason: result.reason ?? `insufficient ${component}` };
  }
  return {
    allowed: true,
    remaining: result.remaining,
    source: result.source === 'child' ? 'child' : 'family',
    write: () => {
      const { parentUid: _owner, createdAt: _created, updatedAt: _updated, ...toWrite } = result.ledger;
      tx.set(
        ledger.ref,
        {
          ...toWrite,
          ...(ledger.stored ? {} : { createdAt: FieldValue.serverTimestamp() }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    },
  };
}

/** Read-only: would one unit of `component` be allowed now? (A missing ledger counts as the free tier.) */
export async function checkAllowance(
  db: Firestore,
  component: EntitlementComponentKey,
  ownerUid: string,
  childId: string | null,
  now: Date = new Date()
): Promise<{ allowed: boolean; remaining: number }> {
  const snapshot = await db.collection(LEDGERS_COLLECTION).doc(ownerUid).get();
  const stored = snapshot.exists ? ({ parentUid: ownerUid, ...snapshot.data() } as EntitlementLedger) : null;
  const ensured = stored ? ensureFreeTier(stored, now) : buildFreeTierLedger(ownerUid, now);
  const check = canConsume(ensured, component, { parentUid: ownerUid, childId: childId ?? undefined }, 1);
  return { allowed: check.allowed, remaining: check.remaining };
}

/**
 * Give back consumable units (e.g. print credits from a cancelled order) to the
 * pool they were spent from, in the caller's transaction, from the ledger the
 * caller read in it.
 */
export function returnConsumable(
  tx: Transaction,
  ledger: { ref: DocumentReference; stored: EntitlementLedger | null },
  component: EntitlementComponentKey,
  source: 'child' | 'family',
  childId: string | null,
  amount: number
): void {
  const pool = source === 'child' && childId ? ledger.stored?.children?.[childId] : ledger.stored?.family;
  const current = (pool as Record<string, { granted?: number; consumed?: number; balance?: number }> | undefined)?.[component] ?? {};
  const restored = {
    ...current,
    granted: current.granted ?? amount,
    consumed: Math.max(0, (current.consumed ?? amount) - amount),
    balance: (current.balance ?? 0) + amount,
  };
  const patch = source === 'child' && childId ? { children: { [childId]: { [component]: restored } } } : { family: { [component]: restored } };
  tx.set(ledger.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
