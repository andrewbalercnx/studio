import type { Firestore } from 'firebase-admin/firestore';

/**
 * Source of a Firestore instance. Production code uses the Admin SDK default;
 * tests pass an in-memory fake or an emulator-backed instance.
 */
export type DbSource = Firestore | (() => Firestore | Promise<Firestore>);

/** The Admin SDK Firestore, initialised once per process. */
export async function getDb(): Promise<Firestore> {
  const { getServerFirestore } = await import('@/lib/server-firestore');
  return getServerFirestore();
}

export async function resolveDb(source: DbSource | undefined): Promise<Firestore> {
  if (!source) return getDb();
  return typeof source === 'function' ? await source() : source;
}
