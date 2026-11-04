import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn();
vi.mock('@/lib/auth-fetch', () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { BookApiError, ChoiceKeys, createBook, lockBook, retryBookPage, unlockBook } from '../api';
import { bookProgress, isReadableStatus, pageArtState } from '../types';

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('ChoiceKeys', () => {
  it('repeats the key for the same choice (double tap) and makes a new one for another choice', () => {
    let n = 0;
    const keys = new ChoiceKeys(() => `key-${++n}`);
    expect(keys.keyFor('story|form|style-a')).toBe('key-1');
    expect(keys.keyFor('story|form|style-a')).toBe('key-1');
    expect(keys.keyFor('story|form|style-b')).toBe('key-2');
    expect(keys.keyFor('story|form|style-a')).toBe('key-3');
  });

  it('makes UUID-length keys by default (the route requires at least 8 characters)', () => {
    expect(new ChoiceKeys().keyFor('x').length).toBeGreaterThanOrEqual(8);
  });
});

describe('book API calls', () => {
  beforeEach(() => authFetch.mockReset());

  it('createBook posts storyId, formId, styleId and the idempotency key to /api/books', async () => {
    authFetch.mockResolvedValue(respond(201, { ok: true, data: { bookId: 'bk_1', manuscriptId: 'ms_1', status: 'illustrating', created: true } }));
    const result = await createBook({ storyId: 's1', formId: 'picture_book', styleId: 'watercolour', idempotencyKey: 'abcdefgh-1' });
    expect(result.bookId).toBe('bk_1');
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/books');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ storyId: 's1', formId: 'picture_book', styleId: 'watercolour', idempotencyKey: 'abcdefgh-1' });
  });

  it('surfaces the server error message and code', async () => {
    authFetch.mockResolvedValue(respond(402, { ok: false, error: { code: 'ENTITLEMENT_LIMIT', message: "You've used all your books." } }));
    const error = await createBook({ storyId: 's', formId: 'f', styleId: 'y', idempotencyKey: 'abcdefgh' }).catch((e) => e);
    expect(error).toBeInstanceOf(BookApiError);
    expect(error.code).toBe('ENTITLEMENT_LIMIT');
    expect(error.status).toBe(402);
    expect(error.message).toBe("You've used all your books.");
  });

  it('retry, lock and unlock call their routes', async () => {
    authFetch.mockResolvedValue(respond(200, { ok: true, data: {} }));
    await retryBookPage('bk_1', 3);
    await lockBook('bk_1');
    await unlockBook('bk_1');
    expect(authFetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/books/bk_1/pages/3/retry',
      '/api/books/bk_1/lock',
      '/api/books/bk_1/unlock',
    ]);
  });
});

describe('Book status helpers', () => {
  it('only names the server status: ready, partial and locked are readable', () => {
    expect(isReadableStatus('ready')).toBe(true);
    expect(isReadableStatus('partial')).toBe(true);
    expect(isReadableStatus('locked')).toBe(true);
    expect(isReadableStatus('illustrating')).toBe(false);
    expect(isReadableStatus('failed')).toBe(false);
    expect(isReadableStatus(undefined)).toBe(false);
  });

  it('reads a page picture state from artUrl and the latest art job', () => {
    expect(pageArtState({ artUrl: 'https://x', artJob: null })).toBe('done');
    expect(pageArtState({ artUrl: null, artJob: { jobId: 'j', status: 'failed' } })).toBe('failed');
    expect(pageArtState({ artUrl: null, artJob: { jobId: 'j', status: 'cancelled' } })).toBe('failed');
    expect(pageArtState({ artUrl: null, artJob: { jobId: 'j', status: 'running' } })).toBe('pending');
    expect(pageArtState({ artUrl: null, artJob: null })).toBe('pending');
  });
});

describe('bookProgress stages', () => {
  const page = (kind: 'cover' | 'story' | 'blank', art: boolean) => ({ kind, artUrl: art ? 'https://x' : null, artJob: null });
  const sheet = (ready: boolean) => ({ imageUrl: ready ? 'https://s' : null });
  const pages = [page('cover', false), page('story', false), page('story', false), page('blank', false)]; // 3 art pages

  it('is writing while the manuscript is still paginating (no page count yet)', () => {
    const p = bookProgress({ manuscriptStatus: 'paginating', pages: [], castSheets: [] });
    expect(p.stage).toBe('writing');
    expect(p.total).toBeNull();
  });

  it('is drawing the characters while cast sheets run and no page art is done', () => {
    const p = bookProgress({ manuscriptStatus: 'ready', pages, castSheets: [sheet(true), sheet(false), sheet(false)] });
    expect(p).toMatchObject({ stage: 'characters', done: 1, total: 3 });
    expect(p.percent).toBe(15); // 10 + round(15 * 1/3)
  });

  it('moves to the pages once every cast sheet is ready', () => {
    const p = bookProgress({ manuscriptStatus: 'ready', pages, castSheets: [sheet(true), sheet(true), sheet(true)] });
    expect(p).toMatchObject({ stage: 'pages', done: 0, total: 3 });
  });

  it('skips the characters stage when there are no cast sheets', () => {
    const p = bookProgress({ manuscriptStatus: 'ready', pages, castSheets: [] });
    expect(p.stage).toBe('pages');
  });

  it('counts finished page art and reaches 100% when every page is drawn', () => {
    const done = [page('cover', true), page('story', true), page('story', true), page('blank', false)];
    const p = bookProgress({ manuscriptStatus: 'ready', pages: done, castSheets: [sheet(true)] });
    expect(p).toMatchObject({ stage: 'pages', done: 3, total: 3, percent: 100 });
  });
});
