import { describe, expect, it, vi } from 'vitest';
import { ChoiceKeys, createStoryPicClient, isRetryLater, kidSafeMessage, likenessBusy, StoryPicApiError } from '../index';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A client over a fake fetch that answers each request in turn. */
function setup(...answers: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const answer = answers.shift() ?? { body: { ok: true, data: {} } };
    if (answer instanceof Error) throw answer;
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer.body } as Response;
  });
  const client = createStoryPicClient({ baseUrl: 'https://app.test/api/', getToken: async () => 'tok', fetch: fetchImpl as unknown as typeof fetch });
  return { client, calls };
}

const ok = (data: unknown, status = 200) => ({ status, body: { ok: true, data } });

describe('the transport', () => {
  it('sends the bearer token, JSON body and method to the base URL, and unwraps { ok, data }', async () => {
    const { client, calls } = setup(ok({ storyId: 'st_1', status: 'creating', turn: { index: 0 }, created: true }, 201));
    const created = await client.stories.create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'key-123456' });
    expect(created.storyId).toBe('st_1');
    expect(calls[0]).toMatchObject({
      url: 'https://app.test/api/stories',
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: { childId: 'c1', modeId: 'wizard', idempotencyKey: 'key-123456' },
    });
  });

  it('sends no token header when nobody is signed in, and no body on a GET', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { modes: [] } }) }) as unknown as Response);
    const client = createStoryPicClient({ baseUrl: '/api', getToken: async () => null, fetch: fetchImpl as unknown as typeof fetch });
    await client.stories.listModes();
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({});
    expect(init.body).toBeUndefined();
  });

  it('turns { ok: false, error } into StoryPicApiError with the server code, message and status', async () => {
    const { client } = setup({ status: 409, body: { ok: false, error: { code: 'TURN_IN_PROGRESS', message: 'busy' } } });
    const error = await client.stories.sendTurn('st_1', { kind: 'text', text: 'hi' }, 'key-abcdefgh').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoryPicApiError);
    expect(error).toMatchObject({ code: 'TURN_IN_PROGRESS', status: 409, message: 'busy' });
    expect(isRetryLater(error)).toBe(true);
  });

  it('reads the older error shapes ({ error: string }, { code, message }) and an unreadable body', async () => {
    const { client } = setup(
      { status: 500, body: { ok: false, error: 'Failed to fetch output types' } },
      { status: 400, body: { ok: false, code: 'PIN_NOT_SET', message: 'No PIN configured.' } },
      { status: 502, body: null }
    );
    await expect(client.catalog.outputTypes()).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 500, message: 'Failed to fetch output types' });
    await expect(client.verifyPin('1234')).rejects.toMatchObject({ code: 'PIN_NOT_SET', status: 400, message: 'No PIN configured.' });
    await expect(client.stories.listModes()).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 502 });
  });

  it('a network failure is code NETWORK, status 0, and worth retrying', async () => {
    const { client } = setup(new TypeError('offline'));
    const error = await client.books.list().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'NETWORK', status: 0 });
    expect(isRetryLater(error)).toBe(true);
  });
});

describe('the areas call their routes', () => {
  it('stories', async () => {
    const { client, calls } = setup(ok({ stories: [{ id: 'st_1' }] }), ok({ story: { id: 'st_1' }, turns: [] }), ok({}), ok({}));
    expect(await client.stories.list('c 1')).toEqual([{ id: 'st_1' }]);
    expect((await client.stories.get('st_1')).story.id).toBe('st_1');
    await client.stories.abandon('st_1');
    await client.stories.retryFinish('st_1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://app.test/api/stories?childId=c+1',
      'GET https://app.test/api/stories/st_1',
      'POST https://app.test/api/stories/st_1/abandon',
      'POST https://app.test/api/stories/st_1/finish',
    ]);
  });

  it('books and print', async () => {
    const { client, calls } = setup();
    await client.books.create({ storyId: 's1', formId: 'picture_book', styleId: 'watercolour', idempotencyKey: 'abcdefgh-1' });
    await client.books.list({ childId: 'c1' });
    await client.books.retryPage('bk_1', 3);
    await client.books.lock('bk_1');
    await client.books.unlock('bk_1');
    await client.books.printOptions('bk_1');
    await client.books.startRender('bk_1', 'lay_1', 'key-render-1');
    await client.books.getRender('bk_1', 'r_1');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://app.test/api', '')}`)).toEqual([
      'POST /books',
      'GET /books?childId=c1',
      'POST /books/bk_1/pages/3/retry',
      'POST /books/bk_1/lock',
      'POST /books/bk_1/unlock',
      'GET /books/bk_1/print-options',
      'POST /books/bk_1/renders',
      'GET /books/bk_1/renders/r_1',
    ]);
    expect(calls[6].body).toEqual({ layoutId: 'lay_1', idempotencyKey: 'key-render-1' });
  });

  it('orders, parent and admin', async () => {
    const { client, calls } = setup();
    await client.orders.list();
    await client.orders.checkout('po 1');
    await client.orders.payWithCredits('po1');
    await client.orders.admin.list('paid');
    await client.orders.admin.cancel('po1', null);
    await client.orders.admin.retrySubmit('po1', true);
    await client.orders.admin.updateSettings({ requireAdminApproval: false });
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://app.test/api', '')}`)).toEqual([
      'GET /orders',
      'POST /orders/po%201/checkout',
      'POST /orders/po1/pay-with-credits',
      'GET /admin/orders?status=paid',
      'POST /admin/orders/po1/cancel',
      'POST /admin/orders/po1/retry',
      'PUT /admin/orders/settings',
    ]);
    expect(calls[4].body).toEqual({ note: null });
    expect(calls[5].body).toEqual({ force: true });
  });

  it('children and characters, including the bare mobile shape', async () => {
    const { client, calls } = setup(ok([]), ok([]), ok({}), ok({}), ok({}), ok({}), { body: [{ id: 'c1', displayName: 'Emma', likeness: {} }] });
    await client.people.listChildren();
    await client.people.listCharacters({ childId: 'c1', includeHelp: true });
    await client.people.get('child', 'c1');
    await client.people.update('character', 'chr_1', { displayName: 'Rex' });
    await client.people.setAvatar('child', 'c1', 'photo', 'p1');
    await client.people.removePhoto('child', 'c1', 'p 1');
    expect((await client.people.childRecords())[0].displayName).toBe('Emma');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://app.test/api', '')}`)).toEqual([
      'GET /children?view=person',
      'GET /characters?childId=c1&includeHelp=1',
      'GET /children/c1?view=person',
      'PATCH /characters/chr_1',
      'POST /children/c1/avatar',
      'DELETE /children/c1/photos/p%201',
      'GET /children',
    ]);
    expect(calls[4].body).toEqual({ source: 'photo', photoId: 'p1' });
  });

  it('verifyPin: true on success, false for a wrong PIN, throws when locked', async () => {
    const { client } = setup(
      { body: { ok: true, message: 'PIN verified.' } },
      { status: 401, body: { ok: false, code: 'INCORRECT_PIN', message: 'Incorrect PIN.' } },
      { status: 429, body: { ok: false, code: 'PIN_LOCKED', message: 'Too many incorrect attempts.' } }
    );
    expect(await client.verifyPin('1234')).toBe(true);
    expect(await client.verifyPin('0000')).toBe(false);
    await expect(client.verifyPin('0000')).rejects.toMatchObject({ code: 'PIN_LOCKED', status: 429 });
  });

  it('speak answers the audio URL and fails without one', async () => {
    const { client } = setup({ body: { ok: true, audioUrl: 'https://a/x.mp3' } }, { body: { ok: true } });
    expect(await client.speak('hello')).toBe('https://a/x.mp3');
    await expect(client.speak('hello')).rejects.toMatchObject({ code: 'TTS_FAILED' });
  });
});

describe('helpers', () => {
  it('ChoiceKeys repeats the key for the same choice and makes a new one for another', () => {
    let n = 0;
    const keys = new ChoiceKeys(() => `key-${++n}`);
    expect(keys.keyFor('a')).toBe('key-1');
    expect(keys.keyFor('a')).toBe('key-1');
    expect(keys.keyFor('b')).toBe('key-2');
    expect(new ChoiceKeys().keyFor('x').length).toBeGreaterThanOrEqual(8);
  });

  it('kid-safe messages pass through server copy written for children and hide everything else', () => {
    expect(kidSafeMessage(new StoryPicApiError("You've used all your stories.", 'ENTITLEMENT_LIMIT', 402))).toBe("You've used all your stories.");
    expect(kidSafeMessage(new StoryPicApiError('model exploded', 'AI_UNAVAILABLE', 503))).not.toContain('model');
    expect(kidSafeMessage(new StoryPicApiError('Internal server error', 'INTERNAL', 500))).not.toContain('Internal');
    expect(kidSafeMessage(new Error('Firestore permission-denied'))).not.toContain('Firestore');
  });

  it('likenessBusy is true while any part is working', () => {
    const idle = { describe: 'idle', portrait: 'idle', avatar: 'idle', animate: 'idle' } as const;
    expect(likenessBusy({ likenessStatus: idle })).toBe(false);
    expect(likenessBusy({ likenessStatus: { ...idle, portrait: 'working' } })).toBe(true);
  });
});
