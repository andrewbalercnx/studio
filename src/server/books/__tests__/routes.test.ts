import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

const verifyUserToken = vi.fn();
vi.mock('@/server/http/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../http/auth')>();
  return { ...actual, verifyUserToken: (...args: unknown[]) => verifyUserToken(...args) };
});

let bench: import('./helpers').Bench;
vi.mock('@/server/books', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>();
  return { ...actual, getBookServiceDeps: async () => bench.services };
});

import { UnauthenticatedError } from '../../errors';
import { POST as createBookRoute } from '@/app/api/books/route';
import { POST as lockRoute } from '@/app/api/books/[bookId]/lock/route';
import { POST as retryRoute } from '@/app/api/books/[bookId]/pages/[pageNumber]/retry/route';
import { POST as unlockRoute } from '@/app/api/books/[bookId]/unlock/route';
import { POST as createManuscriptRoute } from '@/app/api/manuscripts/route';
import { createBench, seed, user } from './helpers';

function post(path: string, body?: unknown) {
  return new Request(`https://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

async function call(response: Promise<Response>) {
  const res = await response;
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  verifyUserToken.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench();
  await seed(bench.db);
});

describe('book routes', () => {
  it('require a user token (401)', async () => {
    verifyUserToken.mockRejectedValue(new UnauthenticatedError('Missing ID token'));
    const responses = await Promise.all([
      call(createManuscriptRoute(post('/api/manuscripts', { storyId: 's1', formId: 'picture' }))),
      call(createBookRoute(post('/api/books', { storyId: 's1', formId: 'picture', styleId: 'water', idempotencyKey: 'route-test-0001' }))),
      call(retryRoute(post('/api/books/b/pages/2/retry'), params({ bookId: 'b', pageNumber: '2' }))),
      call(lockRoute(post('/api/books/b/lock'), params({ bookId: 'b' }))),
      call(unlockRoute(post('/api/books/b/unlock'), params({ bookId: 'b' }))),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
  });

  it('create a manuscript and a book for the owner, and deny another family (403)', async () => {
    verifyUserToken.mockResolvedValue(user('p1'));
    const manuscript = await call(createManuscriptRoute(post('/api/manuscripts', { storyId: 's1', formId: 'picture', length: 16 })));
    expect(manuscript).toMatchObject({ status: 201, body: { ok: true, data: { status: 'paginating', created: true } } });
    const again = await call(createManuscriptRoute(post('/api/manuscripts', { storyId: 's1', formId: 'picture', length: 16 })));
    expect(again).toMatchObject({ status: 200, body: { data: { created: false } } });

    const book = await call(createBookRoute(post('/api/books', { storyId: 's1', formId: 'picture', styleId: 'water', idempotencyKey: 'route-test-0002' })));
    expect(book).toMatchObject({ status: 201, body: { ok: true, data: { status: 'illustrating', created: true } } });
    const bookId = book.body.data.bookId as string;
    await bench.drain();

    verifyUserToken.mockResolvedValue(user('p2'));
    const denied = await Promise.all([
      call(createManuscriptRoute(post('/api/manuscripts', { storyId: 's1', formId: 'picture' }))),
      call(createBookRoute(post('/api/books', { storyId: 's1', formId: 'picture', styleId: 'water', idempotencyKey: 'route-test-0003' }))),
      call(createBookRoute(post('/api/books', { manuscriptId: manuscript.body.data.manuscriptId, styleId: 'water', idempotencyKey: 'route-test-0004' }))),
      call(retryRoute(post(`/api/books/${bookId}/pages/2/retry`), params({ bookId, pageNumber: '2' }))),
      call(lockRoute(post(`/api/books/${bookId}/lock`), params({ bookId }))),
      call(unlockRoute(post(`/api/books/${bookId}/unlock`), params({ bookId }))),
    ]);
    expect(denied.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);

    verifyUserToken.mockResolvedValue(user('p1'));
    expect(await call(lockRoute(post(`/api/books/${bookId}/lock`), params({ bookId })))).toMatchObject({
      status: 200,
      body: { data: { status: 'locked' } },
    });
    expect(await call(unlockRoute(post(`/api/books/${bookId}/unlock`), params({ bookId })))).toMatchObject({
      status: 200,
      body: { data: { status: 'ready' } },
    });
  });

  it('validate bodies and parameters (400) and report missing things (404)', async () => {
    verifyUserToken.mockResolvedValue(user('p1'));
    expect((await call(createBookRoute(post('/api/books', { styleId: 'water', idempotencyKey: 'route-test-0005' })))).status).toBe(400);
    // A Book must carry an idempotency key, so a double tap cannot charge twice.
    expect((await call(createBookRoute(post('/api/books', { storyId: 's1', formId: 'picture', styleId: 'water' })))).status).toBe(400);
    expect((await call(createManuscriptRoute(post('/api/manuscripts', { storyId: 's1' })))).status).toBe(400);
    expect((await call(retryRoute(post('/api/books/b/pages/x/retry'), params({ bookId: 'b', pageNumber: 'x' })))).body.error.code).toBe('INVALID_PAGE');
    expect((await call(lockRoute(post('/api/books/missing/lock'), params({ bookId: 'missing' })))).status).toBe(404);
    expect((await call(createManuscriptRoute(post('/api/manuscripts', { storyId: 'nope', formId: 'picture' })))).status).toBe(404);
  });

  it('applies the persona scope (403 PERSONA_SCOPE_MISMATCH)', async () => {
    verifyUserToken.mockResolvedValue(user('p1'));
    enforcePersonaScope.mockResolvedValue({ ok: false, status: 403, code: 'PERSONA_SCOPE_MISMATCH', message: 'mismatch' });
    const response = await call(createBookRoute(post('/api/books', { storyId: 's1', formId: 'picture', styleId: 'water', idempotencyKey: 'route-test-0006' })));
    expect(response).toMatchObject({ status: 403, body: { error: { code: 'PERSONA_SCOPE_MISMATCH' } } });
  });
});
