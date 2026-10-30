import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { Timestamp } from 'firebase-admin/firestore';
import { DataIntegrityError } from '../../errors';
import { books, manuscriptPages, manuscripts } from '../../data/repositories';
import { createBook } from '../../books/service';
import { isFinished, loadStorySource, storyFromDocument } from '../../books/story-source';
import { createStory, submitTurn } from '../service';
import { createBench, key, seed, user, type Bench } from './helpers';

const p1 = user('p1');
let bench: Bench;

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench({ testMode: true });
  await seed(bench.db);
  await bench.db.collection('storyOutputTypes').doc('picture').set({ name: 'Picture book', status: 'live', category: 'picture_book', layoutHints: { pageCount: 12 } });
  await bench.db.collection('imageStyles').doc('water').set({ title: 'Watercolour', stylePrompt: 'soft watercolour' });
});

const stamp = Timestamp.fromMillis(0);

describe('story source: both shapes until slice 5.4', () => {
  it('reads a legacy story (parentUid, storyText, metadata.title)', () => {
    const legacy = storyFromDocument('s1', { parentUid: 'p1', childId: 'c1', storyText: '$$c1$$ ran.', actors: ['ch1'], metadata: { title: 'Run' } });
    expect(legacy).toMatchObject({ shape: 'legacy', ownerUid: 'p1', childId: 'c1', text: '$$c1$$ ran.', title: 'Run', actorIds: ['ch1'], status: null });
    expect(isFinished(legacy)).toBe(true);
  });

  it('reads a target Story (ownerUid, text with cast tokens, cast) and only a complete one is finished', () => {
    const doc = {
      schemaVersion: 2,
      ownerUid: 'p1',
      childId: 'c1',
      modeId: 'wizard',
      status: 'finishing',
      text: '[[cast:c1]] and [[cast:ch1]] ran.',
      cast: [
        { castId: 'c1', ref: { kind: 'child', id: 'c1' }, role: 'hero', addedBy: 'setup' },
        { castId: 'ch1', ref: { kind: 'character', id: 'ch1' }, role: 'supporting', addedBy: 'child' },
      ],
      title: 'Run',
      createdAt: stamp,
      updatedAt: stamp,
    };
    const story = storyFromDocument('s2', doc);
    expect(story).toMatchObject({ shape: 'story', ownerUid: 'p1', text: '[[cast:c1]] and [[cast:ch1]] ran.', actorIds: ['ch1'], status: 'finishing', title: 'Run' });
    expect(isFinished(story)).toBe(false);
    expect(isFinished({ ...story, status: 'complete' })).toBe(true);
    expect(() => storyFromDocument('s3', { ...doc, modeId: 'gemini3' })).toThrow(DataIntegrityError);
  });

  it('makes a Book from a Story created through the new routes, and refuses one still being created', async () => {
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });
    await expect(createBook(bench.bookServices, p1, { storyId: created.storyId, formId: 'picture', styleId: 'water', idempotencyKey: key() })).rejects.toMatchObject({
      status: 409,
      code: 'STORY_NOT_READY',
    });
    for (let i = 0; i < 4; i++) {
      await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'B' }, idempotencyKey: key() });
    }
    await bench.drain();
    const source = await loadStorySource(bench.db, created.storyId);
    expect(source).toMatchObject({ shape: 'story', status: 'complete', title: "Emma's Big Day" });

    const book = await createBook(bench.bookServices, p1, { storyId: created.storyId, formId: 'picture', styleId: 'water', idempotencyKey: key() });
    await bench.drain();
    expect(await books.using(bench.db).require(book.bookId)).toMatchObject({ status: 'ready', childId: 'c1', ownerUid: 'p1' });
    expect(await manuscripts.using(bench.db).require(book.manuscriptId)).toMatchObject({ status: 'ready', title: "Emma's Big Day" });
    const pages = await manuscriptPages.using(bench.db).of(book.manuscriptId).where({});
    expect(pages.length).toBe(12);
    expect(pages.map((p) => p.text).join(' ')).toContain('Emma');
    expect(pages.map((p) => p.text).join(' ')).not.toContain('[[cast:');
  });
});
