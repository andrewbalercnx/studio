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
import type {
  EntitlementLedger,
  EntitlementCheck,
  EntitlementComponentKey,
  EntitlementSummary,
  LedgerScope,
} from '@/lib/types';
import { buildFreeTierLedger, ensureFreeTier } from './grant';
import { canConsume, consume, remainingForScope } from './check';

/**
 * Firestore collection holding one ledger document per family, keyed by parentUid.
 * Module-local (not exported): this file carries the `'use server'` directive, under which Next
 * only permits async-function exports. Keep it internal; if another module needs the name, lift it
 * into a plain (non-'use server') constants module rather than exporting it here.
 */
const ENTITLEMENT_LEDGERS_COLLECTION = 'entitlementLedgers';

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
 * Read-only pre-flight check: would consuming `amount` of `component` under `scope` be allowed?
 * Treats a missing ledger as a freshly free-tier-seeded one (in memory only — does NOT persist),
 * so a brand-new family is correctly granted its free allowance. Use this to gate the UI before
 * doing expensive work; the authoritative decrement is consumeEntitlement (below).
 */
export async function checkEntitlement(
  parentUid: string,
  component: EntitlementComponentKey,
  scope: LedgerScope,
  amount = 1,
): Promise<EntitlementCheck> {
  const stored = await getLedger(parentUid);
  const ledger = stored ? ensureFreeTier(stored) : buildFreeTierLedger(parentUid);
  return canConsume(ledger, component, scope, amount);
}

/**
 * Read-only roll-up of remaining story/storybook capacity for display ("X stories left"). Like
 * checkEntitlement it treats a missing ledger as free-tier-seeded in memory and never writes. The
 * numbers are the total spendable across the child pool + family pool for the given scope.
 */
export async function summarizeEntitlements(
  parentUid: string,
  childId?: string,
): Promise<EntitlementSummary> {
  const stored = await getLedger(parentUid);
  const ledger = stored ? ensureFreeTier(stored) : buildFreeTierLedger(parentUid);
  const scope: LedgerScope = { parentUid, childId };
  return {
    story: { remaining: remainingForScope(ledger, 'story_allowance', scope) },
    storybook: { remaining: remainingForScope(ledger, 'storybook_allowance', scope) },
  };
}

/**
 * Authoritative consume: atomically check-and-decrement `amount` of `component` under `scope`.
 *
 * The whole read-modify-write runs inside a Firestore transaction so concurrent creation requests
 * cannot double-spend the same allowance/credit. A missing ledger is seeded with the free tier
 * first (so a new family gets its free allowance), and a legacy un-seeded ledger is seeded
 * idempotently — both persisted even when the request is ultimately denied, matching
 * getOrCreateLedger's semantics.
 *
 * Returns the EntitlementCheck decision: `allowed` plus post-decrement `remaining` (and `source`
 * scope) on success, or `allowed: false` with a `reason` when at the limit. The ledger is only
 * decremented when allowed. Server-authoritative; never call from client code.
 */
export async function consumeEntitlement(
  parentUid: string,
  component: EntitlementComponentKey,
  scope: LedgerScope,
  amount = 1,
): Promise<EntitlementCheck> {
  const firestore = await getServerFirestore();
  const ref = firestore.doc(ledgerDocPath(parentUid));

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const isNew = !snap.exists;

    const stored: EntitlementLedger | null = isNew
      ? null
      : { parentUid, ...(snap.data() as Omit<EntitlementLedger, 'parentUid'>) };
    const ensured = stored ? ensureFreeTier(stored) : buildFreeTierLedger(parentUid);
    const seededChanged = isNew || ensured !== stored;

    const result = consume(ensured, component, scope, amount);
    const finalLedger = result.allowed ? result.ledger : ensured;

    // Persist when we actually decremented, or when free-tier seeding produced new state we
    // want durable even on denial (so the next read is consistent and cheap).
    if (result.allowed || seededChanged) {
      const { parentUid: _omit, createdAt: _c, ...toWrite } = finalLedger;
      tx.set(
        ref,
        {
          ...toWrite,
          ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return result.allowed
      ? { allowed: true, remaining: result.remaining, source: result.source }
      : { allowed: false, remaining: result.remaining, reason: result.reason };
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
