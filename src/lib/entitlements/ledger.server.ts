'use server';

/**
 * Server-side access to a family's entitlement ledger. Mirrors the other *.server.ts files
 * (admin SDK via getServerFirestore). Entitlements are server-authoritative: only this layer
 * (running with the admin SDK, bypassing rules) ever writes ledger documents.
 *
 * Scope of Stream D: read + ensure-the-free-tier-exists. Granting on purchase and consuming at
 * story/storybook/print creation are deliberately NOT wired here — that enforcement lands later.
 */
import { getServerFirestore } from '@/lib/server-firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { EntitlementLedger } from '@/lib/types';
import { buildFreeTierLedger, ensureFreeTier } from './grant';

/** Firestore collection holding one ledger document per family, keyed by parentUid. */
export const ENTITLEMENT_LEDGERS_COLLECTION = 'entitlementLedgers';

function ledgerDocPath(parentUid: string): string {
  return `${ENTITLEMENT_LEDGERS_COLLECTION}/${parentUid}`;
}

/**
 * Read a family's ledger from Firestore. Returns null if none exists yet (caller may seed it
 * with getOrCreateLedger). Does not create anything.
 */
export async function getLedger(parentUid: string): Promise<EntitlementLedger | null> {
  const firestore = await getServerFirestore();
  const snap = await firestore.doc(ledgerDocPath(parentUid)).get();
  if (!snap.exists) return null;
  return { parentUid, ...(snap.data() as Omit<EntitlementLedger, 'parentUid'>) };
}

/**
 * Read a family's ledger, creating and seeding it with the free tier if it does not yet exist.
 * If a ledger exists but was never free-tier-seeded (legacy/manual), seed it idempotently.
 * The whole read-modify-write runs in a transaction to avoid double-seeding under concurrency.
 */
export async function getOrCreateLedger(parentUid: string): Promise<EntitlementLedger> {
  const firestore = await getServerFirestore();
  const ref = firestore.doc(ledgerDocPath(parentUid));

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      const seeded = buildFreeTierLedger(parentUid);
      const { parentUid: _omit, ...toWrite } = seeded;
      tx.set(ref, {
        ...toWrite,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return seeded;
    }

    const existing: EntitlementLedger = {
      parentUid,
      ...(snap.data() as Omit<EntitlementLedger, 'parentUid'>),
    };
    const ensured = ensureFreeTier(existing);
    if (ensured !== existing) {
      const { parentUid: _omit, createdAt: _c, ...toWrite } = ensured;
      tx.set(
        ref,
        { ...toWrite, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    return ensured;
  });
}

/**
 * Persist a ledger produced by the pure grant/consume helpers. Stamps updatedAt server-side.
 * Server-authoritative write; never call this from client code.
 */
export async function saveLedger(ledger: EntitlementLedger): Promise<void> {
  const firestore = await getServerFirestore();
  const ref = firestore.doc(ledgerDocPath(ledger.parentUid));
  const { parentUid: _omit, createdAt: _c, ...toWrite } = ledger;
  await ref.set(
    { ...toWrite, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
