import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const verifyUserToken = vi.fn();
const verifyInternalCaller = vi.fn();
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    verifyUserToken: (...args: unknown[]) => verifyUserToken(...args),
    verifyInternalCaller: (...args: unknown[]) => verifyInternalCaller(...args),
  };
});
vi.mock('@/lib/persona.server', () => ({ enforcePersonaScope: vi.fn() }));

import {
  BadRequestError,
  ConflictError,
  DataIntegrityError,
  NotFoundError,
  UnauthenticatedError,
} from '../../errors';
import { ok, withRoute } from '../with-route';

function user(uid: string, claims: Record<string, unknown> = {}) {
  return { uid, email: null, claims: { uid, ...claims } };
}

function post(body?: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.example/api/things', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  verifyUserToken.mockReset();
  verifyInternalCaller.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('withRoute auth modes', () => {
  it('public: does not verify credentials', async () => {
    const handler = withRoute({ auth: 'public' }, ({ user }) => ({ user: user ?? null }));
    expect(await json(await handler(post()))).toEqual({ status: 200, body: { ok: true, data: { user: null } } });
    expect(verifyUserToken).not.toHaveBeenCalled();
  });

  it('user: exposes the verified user', async () => {
    verifyUserToken.mockResolvedValue(user('u1'));
    const handler = withRoute({ auth: 'user' }, ({ user }) => ({ uid: user.uid }));
    expect(await json(await handler(post()))).toEqual({ status: 200, body: { ok: true, data: { uid: 'u1' } } });
  });

  it('user: maps a failed verification to 401', async () => {
    verifyUserToken.mockRejectedValue(new UnauthenticatedError('Missing ID token'));
    const handler = withRoute({ auth: 'user' }, () => 'never');
    expect(await json(await handler(post()))).toEqual({
      status: 401,
      body: { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Missing ID token' } },
    });
  });

  it('admin: requires the isAdmin claim', async () => {
    verifyUserToken.mockResolvedValue(user('u1', { isWriter: true }));
    const handler = withRoute({ auth: 'admin' }, () => 'secret');
    expect((await handler(post())).status).toBe(403);

    verifyUserToken.mockResolvedValue(user('a1', { isAdmin: true }));
    expect(await json(await handler(post()))).toEqual({ status: 200, body: { ok: true, data: 'secret' } });
  });

  it('internal: exposes the verified caller and never accepts user tokens', async () => {
    verifyInternalCaller.mockResolvedValue({ email: 'sa@p.iam.gserviceaccount.com' });
    const handler = withRoute({ auth: 'internal' }, ({ caller }) => caller.email);
    expect(await json(await handler(post()))).toEqual({
      status: 200,
      body: { ok: true, data: 'sa@p.iam.gserviceaccount.com' },
    });
    expect(verifyUserToken).not.toHaveBeenCalled();
  });
});

describe('withRoute body validation', () => {
  const schema = z.object({ title: z.string().min(1), pages: z.number().int().default(12) });

  it('passes the parsed body (with defaults) to the handler', async () => {
    const handler = withRoute({ auth: 'public', body: schema }, ({ body }) => body);
    expect((await json(await handler(post({ title: 'Moon' })))).body.data).toEqual({ title: 'Moon', pages: 12 });
  });

  it('rejects an invalid body with 400 and the issues', async () => {
    const handler = withRoute({ auth: 'public', body: schema }, () => 'never');
    const { status, body } = await json(await handler(post({ title: '' })));
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_BODY');
    expect(body.error.details[0].path).toEqual(['title']);
  });

  it('rejects malformed JSON with 400', async () => {
    const handler = withRoute({ auth: 'public', body: schema }, () => 'never');
    const { status, body } = await json(await handler(post('{not json')));
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('validates the body only after authentication', async () => {
    verifyUserToken.mockRejectedValue(new UnauthenticatedError());
    const handler = withRoute({ auth: 'user', body: schema }, () => 'never');
    expect((await handler(post('{not json'))).status).toBe(401);
  });
});

describe('withRoute error mapping and responses', () => {
  it.each([
    [new BadRequestError('bad'), 400, 'BAD_REQUEST'],
    [new NotFoundError('Book not found'), 404, 'NOT_FOUND'],
    [new ConflictError('locked', { code: 'BOOK_LOCKED' }), 409, 'BOOK_LOCKED'],
  ])('maps %s', async (error, status, code) => {
    const handler = withRoute({ auth: 'public' }, () => {
      throw error;
    });
    const result = await json(await handler(post()));
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ ok: false, error: { code, message: error.message } });
  });

  it('hides data-integrity details and unknown errors behind a 500', async () => {
    const integrity = withRoute({ auth: 'public' }, () => {
      throw new DataIntegrityError('books/b1', [{ path: ['status'] }]);
    });
    expect(await json(await integrity(post()))).toEqual({
      status: 500,
      body: { ok: false, error: { code: 'DATA_INTEGRITY', message: 'Stored data is invalid' } },
    });

    const crash = withRoute({ auth: 'public' }, () => {
      throw new Error('db password is hunter2');
    });
    expect(await json(await crash(post()))).toEqual({
      status: 500,
      body: { ok: false, error: { code: 'INTERNAL', message: 'Internal server error' } },
    });
  });

  it('supports custom status, raw responses and route params', async () => {
    const created = withRoute({ auth: 'public' }, () => ok({ id: 'b1' }, 201));
    expect(await json(await created(post()))).toEqual({ status: 201, body: { ok: true, data: { id: 'b1' } } });

    const raw = withRoute({ auth: 'public' }, () => new Response('pdf', { status: 200 }));
    expect(await (await raw(post())).text()).toBe('pdf');

    const withParams = withRoute<'public', undefined, { bookId: string }>({ auth: 'public' }, ({ params }) => params.bookId);
    const response = await withParams(post(), { params: Promise.resolve({ bookId: 'b9' }) });
    expect((await response.json()).data).toBe('b9');
  });
});
