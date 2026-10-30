import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { ConflictError, DataIntegrityError, NotFoundError } from '../../errors';
import { FakeFirestore } from '../../testing/fake-firestore';
import { bookPages, books, renders, stories } from '../repositories';
import { likenessSchema } from '../schemas/likeness';
import { manuscriptPageSchema } from '../schemas/manuscript';

const NOW = 1_700_000_000_000;

let fake: FakeFirestore;
beforeEach(() => {
  fake = new FakeFirestore(() => NOW);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const story = {
  ownerUid: 'u1',
  childId: 'c1',
  modeId: 'wizard' as const,
  status: 'creating' as const,
  cast: [{ castId: 'k1', ref: { kind: 'child' as const, id: 'c1' }, role: 'hero' as const, addedBy: 'setup' as const }],
};

describe('Repository reads', () => {
  it('parses documents through the schema, applying defaults and adding the id', async () => {
    const repo = stories.using(fake.asFirestore());
    const id = await repo.create(story);
    const loaded = await repo.require(id);
    expect(loaded).toMatchObject({ ...story, id, text: null, title: null, synopsis: null, storyTypeId: null });
    expect(loaded.createdAt).toEqual(Timestamp.fromMillis(NOW));
    expect(loaded.updatedAt).toEqual(Timestamp.fromMillis(NOW));
  });

  it('fails loudly on a malformed document', async () => {
    fake.store.set('stories/bad', { ownerUid: 'u1', childId: 'c1', modeId: 'gemini3', status: 'creating', cast: [] });
    const error = await stories.using(fake.asFirestore()).get('bad').catch((e) => e);
    expect(error).toBeInstanceOf(DataIntegrityError);
    expect(error.path).toBe('stories/bad');
    expect(JSON.stringify(error.details)).toContain('modeId');
  });

  it('returns null / throws NotFoundError for missing documents', async () => {
    const repo = stories.using(fake.asFirestore());
    await expect(repo.get('nope')).resolves.toBeNull();
    await expect(repo.require('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists by owner', async () => {
    const repo = stories.using(fake.asFirestore());
    await repo.create(story);
    await repo.create(story);
    await repo.create({ ...story, ownerUid: 'u2' });
    expect((await repo.listByOwner('u1')).map((s) => s.ownerUid)).toEqual(['u1', 'u1']);
    expect(await repo.listByOwner('u1', { limit: 1 })).toHaveLength(1);
  });
});

describe('Repository writes', () => {
  it('validates creates and refuses taken ids', async () => {
    const repo = stories.using(fake.asFirestore());
    await expect(repo.create({ ...story, modeId: 'chat' as never })).rejects.toBeInstanceOf(DataIntegrityError);
    await repo.create(story, { id: 's1' });
    await expect(repo.create(story, { id: 's1' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('validates patches field by field, stamps updatedAt and allows FieldValues', async () => {
    let now = NOW;
    fake = new FakeFirestore(() => now);
    const repo = stories.using(fake.asFirestore());
    const id = await repo.create({ ...story, title: 'Old' });
    now += 5_000;
    await repo.update(id, { status: 'finishing', text: 'Once upon a time', title: FieldValue.delete() as never });
    const loaded = await repo.require(id);
    expect(loaded).toMatchObject({ status: 'finishing', text: 'Once upon a time', title: null });
    expect(loaded.updatedAt.toMillis()).toBe(NOW + 5_000);
    expect(loaded.createdAt.toMillis()).toBe(NOW);

    await expect(repo.update(id, { status: 'done' as never })).rejects.toBeInstanceOf(DataIntegrityError);
    await expect(repo.update(id, { bogus: 1 } as never)).rejects.toBeInstanceOf(DataIntegrityError);
    await expect(repo.update(id, { createdAt: Timestamp.now() } as never)).rejects.toBeInstanceOf(DataIntegrityError);
    await expect(repo.update('nope', { status: 'complete' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps immutable collections immutable', async () => {
    const repo = renders.of('b1').using(fake.asFirestore());
    const id = await repo.create({
      ownerUid: 'u1',
      medium: 'print',
      layoutId: 'square-24',
      files: [{ role: 'interior', storagePath: 'renders/b1/r1/interior.pdf' }],
    });
    expect((await repo.require(id)).files[0].url).toBeNull();
    await expect(repo.update(id, { medium: 'screen' })).rejects.toMatchObject({ code: 'IMMUTABLE' });
  });

  it('works inside transactions', async () => {
    const db = fake.asFirestore();
    const repo = books.using(db);
    const id = await db.runTransaction(async (tx) => {
      const newId = await repo.createIn(tx, {
        ownerUid: 'u1',
        childId: 'c1',
        manuscriptId: 'm1',
        storyId: 's1',
        styleId: 'st',
        layoutId: 'l',
        status: 'draft',
      });
      return newId;
    });
    await db.runTransaction(async (tx) => {
      const book = await repo.requireIn(tx, id);
      await repo.updateIn(tx, id, { status: 'illustrating', art: { ...book.art, total: 24 } });
    });
    expect(await repo.require(id)).toMatchObject({ status: 'illustrating', art: { total: 24, done: 0, failed: 0 } });
  });
});

describe('subcollections and embedded schemas', () => {
  it('scopes subcollection repositories to their parent', async () => {
    const pages = bookPages.using(fake.asFirestore());
    await pages.of('b1').create({ ownerUid: 'u1', pageNumber: 1, kind: 'cover' }, { id: '1' });
    expect(pages.of('b1').path).toBe('books/b1/pages');
    expect(await pages.of('b1').require('1')).toMatchObject({ kind: 'cover', artUrl: null, artJob: null, manuscriptPage: null });
    await expect(pages.of('b2').get('1')).resolves.toBeNull();
  });

  it('parses manuscript pages with their scene', () => {
    const parsed = manuscriptPageSchema.omit({ createdAt: true, updatedAt: true }).parse({
      ownerUid: 'u1',
      pageNumber: 3,
      text: 'Mia jumped.',
      scene: { location: 'park', presentCast: ['k1'], action: 'jumping' },
    });
    expect(parsed.narrationUrl).toBeNull();
    expect(() =>
      manuscriptPageSchema.omit({ createdAt: true, updatedAt: true }).parse({ ownerUid: 'u1', pageNumber: 0, text: '', scene: {} })
    ).toThrow();
  });

  it('defaults an empty likeness', () => {
    expect(likenessSchema.parse({})).toEqual({
      photos: [],
      appearance: null,
      portrait: null,
      avatar: null,
      likenessJob: { describe: null, portrait: null },
    });
  });
});
