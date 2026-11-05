import { beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FakeFirestore } from '../../testing/fake-firestore';
import type { VerifiedUser } from '../../http/auth';
import { batchSetCatalogDocs, catalogCollection, cleanData, createCatalogDoc, deleteCatalogDoc, setCatalogDoc, updateCatalogDoc } from '../writes';

const user = (uid: string, claims: Record<string, unknown> = {}): VerifiedUser =>
  ({ uid, email: `${uid}@test.local`, claims: { uid, ...claims } }) as unknown as VerifiedUser;
const admin = user('a1', { isAdmin: true });
const writer = user('w1', { isWriter: true });
const parent = user('p1');

describe('configuration writes', () => {
  let fake: FakeFirestore;
  let deps: { db: Firestore };
  beforeEach(() => {
    fake = new FakeFirestore();
    deps = { db: fake as unknown as Firestore };
  });

  it('lets writers and admins write authored config, and only admins write print products and generators', async () => {
    await expect(createCatalogDoc(deps, parent, 'storyTypes', { data: { name: 'Quest' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const { id } = await createCatalogDoc(deps, writer, 'storyTypes', { data: { name: 'Quest' } });
    expect((await fake.collection('storyTypes').doc(id).get()).data()).toMatchObject({ name: 'Quest' });
    await expect(setCatalogDoc(deps, writer, 'printProducts', 'pp1', { data: { name: 'Hardback' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await setCatalogDoc(deps, admin, 'printProducts', 'pp1', { data: { name: 'Hardback' } });
    expect((await fake.collection('printProducts').doc('pp1').get()).exists).toBe(true);
    expect(() => catalogCollection('users')).toThrow();
  });

  it('stamps createdAt and updatedAt, ignoring the stamps the client sends', async () => {
    await setCatalogDoc(deps, writer, 'storyPhases', 'warmup', { data: { name: 'Warm-up', createdAt: 'yesterday' } });
    const doc = (await fake.collection('storyPhases').doc('warmup').get()).data()!;
    expect(doc.name).toBe('Warm-up');
    expect(doc.createdAt).not.toBe('yesterday');
    expect(doc.updatedAt).toBeDefined();
  });

  it('merges or replaces on set, and updates nested fields by dotted path', async () => {
    await setCatalogDoc(deps, writer, 'storyOutputTypes', 'pb', { data: { name: 'Picture book', layoutHints: { pageCount: 12, needsImages: true } } });
    await updateCatalogDoc(deps, writer, 'storyOutputTypes', 'pb', { data: { 'layoutHints.pageCount': 16 } });
    expect((await fake.collection('storyOutputTypes').doc('pb').get()).data()).toMatchObject({ layoutHints: { pageCount: 16, needsImages: true } });
    await setCatalogDoc(deps, writer, 'storyOutputTypes', 'pb', { data: { status: 'live' }, merge: true });
    expect((await fake.collection('storyOutputTypes').doc('pb').get()).data()).toMatchObject({ name: 'Picture book', status: 'live' });
    await setCatalogDoc(deps, writer, 'storyOutputTypes', 'pb', { data: { name: 'Only' } });
    expect((await fake.collection('storyOutputTypes').doc('pb').get()).data()!.status).toBeUndefined();
    await expect(updateCatalogDoc(deps, writer, 'storyOutputTypes', 'missing', { data: { name: 'x' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('seeds many documents at once and deletes one', async () => {
    const result = await batchSetCatalogDocs(deps, writer, 'promptConfigs', { items: [{ id: 'a', data: { phase: 'warmup' } }, { id: 'b', data: { phase: 'ending' } }] });
    expect(result.written).toBe(2);
    await deleteCatalogDoc(deps, writer, 'promptConfigs', 'a');
    expect((await fake.collection('promptConfigs').doc('a').get()).exists).toBe(false);
    expect((await fake.collection('promptConfigs').doc('b').get()).exists).toBe(true);
  });

  it('refuses bodies that are not plain objects, reserved keys, dotted keys outside updates and bad ids', async () => {
    expect(() => cleanData([1, 2])).toThrow();
    expect(() => cleanData({ __proto: 1 })).toThrow();
    expect(() => cleanData({ 'a.b': 1 })).toThrow();
    expect(cleanData({ 'a.b': 1 }, { dotted: true })).toEqual({ 'a.b': 1 });
    await expect(setCatalogDoc(deps, writer, 'storyTypes', '../users', { data: {} })).rejects.toMatchObject({ code: 'INVALID_ID' });
  });
});
