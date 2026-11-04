import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { FakeFirestore } from '../../testing/fake-firestore';
import { getBook, listBooks } from '../read';
import { user } from './helpers';

const t = (s: number) => Timestamp.fromMillis(Date.UTC(2026, 10, 1, 12, 0, s));
const p1 = user('p1');

const scene = { location: 'a garden', presentCast: ['ch_1'], action: 'play', locationKey: 'g', mood: 'bright', tag: 'outdoor-day', castActions: [] };

function seed() {
  const fake = new FakeFirestore();
  // Two Books for p1 (newest first by createdAt), one for another family.
  fake.store.set('books/bk_new', { ownerUid: 'p1', manuscriptId: 'ms_1', storyId: 'st_1', childId: 'ch_1', styleId: 'w', layoutId: null, printProductId: null, status: 'illustrating', art: { total: 2, done: 0, failed: 0 }, createdAt: t(30), updatedAt: t(40) });
  fake.store.set('books/bk_old', { ownerUid: 'p1', manuscriptId: 'ms_2', storyId: 'st_2', childId: 'ch_2', styleId: 'w', layoutId: null, printProductId: null, status: 'ready', art: { total: 2, done: 2, failed: 0 }, createdAt: t(10), updatedAt: t(20) });
  fake.store.set('books/bk_other', { ownerUid: 'p2', manuscriptId: 'ms_3', storyId: 'st_3', childId: 'ch_9', styleId: 'w', status: 'ready', art: { total: 1, done: 1, failed: 0 }, createdAt: t(5), updatedAt: t(6) });

  fake.store.set('manuscripts/ms_1', { ownerUid: 'p1', storyId: 'st_1', childId: 'ch_1', form: 'picture_book', readingLevel: 'early', length: 1, density: 'low', status: 'ready', title: 'The New One', createdAt: t(28), updatedAt: t(40) });
  fake.store.set('manuscripts/ms_2', { ownerUid: 'p1', storyId: 'st_2', childId: 'ch_2', form: 'picture_book', readingLevel: 'early', length: 1, density: 'low', status: 'ready', title: 'The Old One', createdAt: t(8), updatedAt: t(20) });
  fake.store.set('manuscripts/ms_1/pages/1', { ownerUid: 'p1', pageNumber: 1, text: 'Once upon a time.', narrationText: null, scene, narrationUrl: null, createdAt: t(28), updatedAt: t(28) });

  // bk_new pages: a cover (no art yet) and one story page.
  fake.store.set('books/bk_new/pages/1', { ownerUid: 'p1', pageNumber: 1, kind: 'cover', manuscriptPage: null, artUrl: null, artJob: null, createdAt: t(30), updatedAt: t(30) });
  fake.store.set('books/bk_new/pages/2', { ownerUid: 'p1', pageNumber: 2, kind: 'story', manuscriptPage: 1, artUrl: null, artJob: null, createdAt: t(30), updatedAt: t(30) });
  fake.store.set('books/bk_new/pages/3', { ownerUid: 'p1', pageNumber: 3, kind: 'end', manuscriptPage: null, artUrl: null, artJob: null, createdAt: t(30), updatedAt: t(30) });
  // One cast sheet still drawing → "characters" stage.
  fake.store.set('books/bk_new/castSheets/ch_1', { ownerUid: 'p1', castId: 'ch_1', ref: { kind: 'child', id: 'ch_1' }, source: 'appearance', imageUrl: null, job: { jobId: 'j', status: 'running' }, createdAt: t(31), updatedAt: t(31) });
  return fake.asFirestore();
}

describe('book read views', () => {
  beforeEach(() => {
    enforcePersonaScope.mockReset();
    enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  });

  it('lists the family Books newest first with title and isReady, excluding other families', async () => {
    const books = await listBooks(seed(), p1);
    expect(books.map((b) => b.id)).toEqual(['bk_new', 'bk_old']);
    expect(books[0]).toMatchObject({ title: 'The New One', isReady: false, status: 'illustrating' });
    expect(books[1]).toMatchObject({ title: 'The Old One', isReady: true, status: 'ready' });
  });

  it('filters the list by child', async () => {
    const books = await listBooks(seed(), p1, { childId: 'ch_2' });
    expect(books.map((b) => b.id)).toEqual(['bk_old']);
  });

  it('reads one Book with its pages joined to the words and the live progress', async () => {
    const view = await getBook(seed(), p1, 'bk_new');
    expect(view).toMatchObject({ id: 'bk_new', title: 'The New One', isReady: false });
    expect(view.pages.map((p) => [p.pageNumber, p.kind, p.text, p.inReader])).toEqual([
      [1, 'cover', null, true],
      [2, 'story', 'Once upon a time.', true],
      [3, 'end', null, false], // typeset for print, not shown on screen
    ]);
    // Manuscript ready, a cast sheet still drawing, no page art done → characters stage.
    expect(view.progress.stage).toBe('characters');
  });

  it('denies a Book the caller does not own', async () => {
    await expect(getBook(seed(), p1, 'bk_other')).rejects.toMatchObject({ status: 403 });
  });

  it('404s an unknown Book', async () => {
    await expect(getBook(seed(), p1, 'bk_missing')).rejects.toMatchObject({ status: 404 });
  });
});
