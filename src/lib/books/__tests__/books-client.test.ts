import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn();
vi.mock('@/lib/auth-fetch', () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { BookApiError, ChoiceKeys, createBook, lockBook, retryBookPage, unlockBook } from '../api';
import { isReadableStatus, pageArtState } from '../types';

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
