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
import { consume } from '@/lib/entitlements/check';
import { buildFreeTierLedger, ensureFreeTier } from '@/lib/entitlements/grant';
import type { EntitlementLedger } from '@/lib/types';

export const LEDGERS_COLLECTION = 'entitlementLedgers';

export type AllowanceCharge =
  | { allowed: true; remaining: number; write: () => void }
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
  const ensured = ledger.stored ? ensureFreeTier(ledger.stored, now) : buildFreeTierLedger(ownerUid, now);
  const result = consume(ensured, 'storybook_allowance', { parentUid: ownerUid, childId: childId ?? undefined }, 1);
  if (!result.allowed) {
    return { allowed: false, remaining: result.remaining, reason: result.reason ?? 'insufficient storybook_allowance' };
  }
  return {
    allowed: true,
    remaining: result.remaining,
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
