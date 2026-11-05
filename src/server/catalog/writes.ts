/**
 * Writes to the authored configuration collections (slice 6.4a): story types,
 * story phases, prompt configs, story output types, print layouts, print
 * products and story generators. The admin and writer pages change them only
 * through `/api/admin/catalog/**`; the Firestore rules refuse browser writes.
 *
 * The documents are free-form configuration, edited whole by their pages, so
 * the body is checked for shape (a plain JSON object of bounded size, no
 * reserved keys) rather than against a schema per collection. The server
 * stamps `createdAt` / `updatedAt`.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors';
import { isAdmin, isPrivileged, type VerifiedUser } from '../http/auth';

/** Each collection and who may write it (as the rules allowed before 6.4a). */
export const CATALOG_COLLECTIONS = {
  storyTypes: 'writer',
  storyPhases: 'writer',
  promptConfigs: 'writer',
  storyOutputTypes: 'writer',
  printLayouts: 'writer',
  printProducts: 'admin',
  storyGenerators: 'admin',
} as const;

export type CatalogCollection = keyof typeof CATALOG_COLLECTIONS;
export type CatalogData = Record<string, unknown>;

const MAX_BYTES = 256 * 1024;
const MAX_BATCH = 400;
const ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
const STAMPS = new Set(['createdAt', 'updatedAt']);

export function catalogCollection(name: string): CatalogCollection {
  if (!Object.prototype.hasOwnProperty.call(CATALOG_COLLECTIONS, name)) {
    throw new NotFoundError('Unknown configuration collection', { code: 'UNKNOWN_COLLECTION' });
  }
  return name as CatalogCollection;
}

function assertMayWrite(user: VerifiedUser, collection: CatalogCollection): void {
  const role = CATALOG_COLLECTIONS[collection];
  const allowed = role === 'admin' ? isAdmin(user) : isPrivileged(user);
  if (!allowed) throw new ForbiddenError(role === 'admin' ? 'Admin access required' : 'Writer access required');
}

function assertId(id: string): void {
  if (!ID.test(id)) throw new BadRequestError('Invalid document id', { code: 'INVALID_ID' });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A plain JSON object of bounded size; drops the server-stamped fields (`createdAt`, `updatedAt`); refuses reserved keys. */
export function cleanData(data: unknown, options: { dotted?: boolean } = {}): CatalogData {
  if (!isPlainObject(data)) throw new BadRequestError('data must be an object', { code: 'INVALID_DATA' });
  if (JSON.stringify(data).length > MAX_BYTES) throw new BadRequestError('The document is too large', { code: 'TOO_LARGE' });
  const out: CatalogData = {};
  for (const [key, value] of Object.entries(data)) {
    if (STAMPS.has(key)) continue;
    if (key.startsWith('__') || key.length === 0 || key.length > 200) throw new BadRequestError(`Invalid field name: ${key}`, { code: 'INVALID_FIELD' });
    if (!options.dotted && key.includes('.')) throw new BadRequestError(`Invalid field name: ${key}`, { code: 'INVALID_FIELD' });
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export type CatalogDeps = { db: Firestore };

/** Create a document (with the given id, or a new one); answers its id. */
export async function createCatalogDoc(deps: CatalogDeps, user: VerifiedUser, collection: CatalogCollection, body: { id?: string; data: unknown }): Promise<{ id: string }> {
  assertMayWrite(user, collection);
  const data = cleanData(body.data);
  const coll = deps.db.collection(collection);
  if (body.id) assertId(body.id);
  const ref = body.id ? coll.doc(body.id) : coll.doc();
  await ref.set({ ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { id: ref.id };
}

/** Replace a document, or merge into it (`merge: true`, creating it when missing). */
export async function setCatalogDoc(deps: CatalogDeps, user: VerifiedUser, collection: CatalogCollection, id: string, body: { data: unknown; merge?: boolean }): Promise<{ id: string }> {
  assertMayWrite(user, collection);
  assertId(id);
  const data = cleanData(body.data);
  const ref = deps.db.collection(collection).doc(id);
  const existing = await ref.get();
  const stamps = existing.exists ? { updatedAt: FieldValue.serverTimestamp() } : { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  await ref.set({ ...data, ...stamps }, { merge: body.merge === true });
  return { id };
}

/** Change some fields of an existing document; dotted paths (`layoutHints.pageCount`) reach nested fields. */
export async function updateCatalogDoc(deps: CatalogDeps, user: VerifiedUser, collection: CatalogCollection, id: string, body: { data: unknown }): Promise<{ id: string }> {
  assertMayWrite(user, collection);
  assertId(id);
  const data = cleanData(body.data, { dotted: true });
  if (Object.keys(data).length === 0) throw new BadRequestError('Nothing to change', { code: 'EMPTY_PATCH' });
  const ref = deps.db.collection(collection).doc(id);
  if (!(await ref.get()).exists) throw new NotFoundError('Document not found', { code: 'NOT_FOUND' });
  await ref.update({ ...data, updatedAt: FieldValue.serverTimestamp() });
  return { id };
}

export async function deleteCatalogDoc(deps: CatalogDeps, user: VerifiedUser, collection: CatalogCollection, id: string): Promise<{ id: string; deleted: true }> {
  assertMayWrite(user, collection);
  assertId(id);
  await deps.db.collection(collection).doc(id).delete();
  return { id, deleted: true };
}

/** Write many documents at once (seeding defaults); each is replaced, or merged with `merge`. */
export async function batchSetCatalogDocs(
  deps: CatalogDeps,
  user: VerifiedUser,
  collection: CatalogCollection,
  body: { items: Array<{ id: string; data: unknown }>; merge?: boolean }
): Promise<{ written: number }> {
  assertMayWrite(user, collection);
  if (!Array.isArray(body.items) || body.items.length === 0) throw new BadRequestError('items must not be empty', { code: 'EMPTY_BATCH' });
  if (body.items.length > MAX_BATCH) throw new BadRequestError(`At most ${MAX_BATCH} items`, { code: 'TOO_MANY_ITEMS' });
  const items = body.items.map((item) => {
    assertId(item.id);
    return { ref: deps.db.collection(collection).doc(item.id), data: cleanData(item.data) };
  });
  await deps.db.runTransaction(async (tx) => {
    for (const { ref, data } of items) {
      const stamps = body.merge ? { updatedAt: FieldValue.serverTimestamp() } : { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      tx.set(ref, { ...data, ...stamps }, { merge: body.merge === true });
    }
  });
  return { written: body.items.length };
}
