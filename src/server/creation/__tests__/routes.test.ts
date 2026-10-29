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
vi.mock('@/server/creation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>();
  return { ...actual, getCreationServiceDeps: async () => bench.services };
});

import { Timestamp } from 'firebase-admin/firestore';
import { UnauthenticatedError } from '../../errors';
import { stories } from '../../data/repositories';
import { POST as createRoute } from '@/app/api/stories/route';
import { POST as turnRoute } from '@/app/api/stories/[storyId]/turns/route';
import { POST as abandonRoute } from '@/app/api/stories/[storyId]/abandon/route';
import { POST as finishRoute } from '@/app/api/stories/[storyId]/finish/route';
import { createBench, ledgerUsed, NOW, seed, user } from './helpers';

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

const create = (body: Record<string, unknown>) => call(createRoute(post('/api/stories', body)));
const turn = (storyId: string, body: Record<string, unknown>) => call(turnRoute(post(`/api/stories/${storyId}/turns`, body), params({ storyId })));
const choice = (optionId: string, idempotencyKey: string) => ({ input: { kind: 'choice', optionId }, idempotencyKey });

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  verifyUserToken.mockReset();
  verifyUserToken.mockResolvedValue(user('p1'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench({ testMode: true });
  await seed(bench.db);
});

describe('story routes: auth, ownership, persona', () => {
  it('require a user token (401)', async () => {
    verifyUserToken.mockRejectedValue(new UnauthenticatedError('Missing ID token'));
    const responses = await Promise.all([
      create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0001' }),
      turn('s', choice('A', 'route-key-0002')),
      call(abandonRoute(post('/api/stories/s/abandon'), params({ storyId: 's' }))),
      call(finishRoute(post('/api/stories/s/finish'), params({ storyId: 's' }))),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401]);
  });

  it('validate bodies (400), and report missing children, modes and stories (404)', async () => {
    expect((await create({ childId: 'c1', modeId: 'wizard' })).status).toBe(400); // idempotency key required
    expect((await create({ childId: 'c1', modeId: 'chat', idempotencyKey: 'route-key-0003' })).status).toBe(400); // retired mode
    expect((await create({ childId: 'nope', modeId: 'wizard', idempotencyKey: 'route-key-0004' })).body.error.code).toBe('CHILD_NOT_FOUND');
    expect((await create({ childId: 'gone', modeId: 'wizard', idempotencyKey: 'route-key-0005' })).status).toBe(404);
    await bench.db.collection('storyGenerators').doc('gemini3').delete();
    expect((await create({ childId: 'c1', modeId: 'freeplay', idempotencyKey: 'route-key-0006' })).body.error.code).toBe('MODE_NOT_FOUND');
    expect((await turn('missing', choice('A', 'route-key-0007'))).status).toBe(404);
    // A legacy story (today's flows) is not a Story these routes act on.
    await bench.db.collection('stories').doc('legacy1').set({ parentUid: 'p1', childId: 'c1', storyText: 'Once.' });
    expect((await turn('legacy1', choice('A', 'route-key-0030'))).body.error.code).toBe('STORY_NOT_FOUND');
    expect((await turn('missing', { input: { kind: 'dance' }, idempotencyKey: 'route-key-0008' })).status).toBe(400);
    expect((await create({ childId: 'c1', modeId: 'wizard', castIds: ['other1234567890xyz'], idempotencyKey: 'route-key-0009' })).body.error.code).toBe('CAST_NOT_FOUND');
  });

  it("deny another family's child and story (403)", async () => {
    const own = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0010' });
    expect(own.status).toBe(201);
    verifyUserToken.mockResolvedValue(user('p2'));
    expect((await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0011' })).status).toBe(403);
    const storyId = own.body.data.storyId as string;
    expect((await turn(storyId, choice('A', 'route-key-0012'))).status).toBe(403);
    expect((await call(abandonRoute(post(`/api/stories/${storyId}/abandon`), params({ storyId })))).status).toBe(403);
  });

  it('apply the persona scope (403 PERSONA_SCOPE_MISMATCH) and give a child persona only modes enabled for kids', async () => {
    const own = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0013' });
    enforcePersonaScope.mockResolvedValue({ ok: false, status: 403, code: 'PERSONA_SCOPE_MISMATCH', message: 'mismatch' });
    expect((await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0014' })).body.error.code).toBe('PERSONA_SCOPE_MISMATCH');
    expect((await turn(own.body.data.storyId, choice('A', 'route-key-0015'))).body.error.code).toBe('PERSONA_SCOPE_MISMATCH');

    // As the child Emma: adventure (not enabled for kids) is refused; as the parent it is allowed.
    enforcePersonaScope.mockResolvedValue({ ok: true, persona: { uid: 'p1', childId: 'c1' } });
    expect((await create({ childId: 'c1', modeId: 'adventure', idempotencyKey: 'route-key-0016' })).body.error.code).toBe('MODE_NOT_FOR_KIDS');
    expect((await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0017' })).status).toBe(201);
    enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
    expect((await create({ childId: 'c1', modeId: 'adventure', idempotencyKey: 'route-key-0018' })).status).toBe(201);

    // A draft mode is refused to parents too.
    await bench.db.collection('storyGenerators').doc('gemini4').set({ status: 'draft', enabledForKids: true });
    expect((await create({ childId: 'c1', modeId: 'guided', idempotencyKey: 'route-key-0019' })).body.error.code).toBe('MODE_NOT_LIVE');
  });
});

describe('story routes: allowance and idempotency', () => {
  it('refuse to start when no story allowance is left (402), before creating anything', async () => {
    await bench.db.collection('entitlementLedgers').doc('p1').set({
      freeTierGranted: true,
      family: { story_allowance: { allowance: 1, used: 1, reset: 'lifetime' } },
    });
    const refused = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0020' });
    expect(refused).toMatchObject({ status: 402, body: { error: { code: 'ENTITLEMENT_LIMIT' } } });
    expect(bench.fake.store.size).toBe([...bench.fake.store.keys()].filter((k) => !k.startsWith('stories/')).length);
    expect(bench.ai).not.toHaveBeenCalled();
  });

  it('a repeated create returns the same Story and first turn (200)', async () => {
    const first = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0021' });
    const again = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0021' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ storyId: first.body.data.storyId, created: false, turn: first.body.data.turn });
    const reused = await create({ childId: 'c1', modeId: 'friends', idempotencyKey: 'route-key-0021' });
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a repeated turn returns the same reply without a new turn; a different concurrent turn gets 409', async () => {
    const created = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0022' });
    const storyId = created.body.data.storyId as string;
    const first = await turn(storyId, choice('A', 'route-key-0023'));
    const repeat = await turn(storyId, choice('A', 'route-key-0023'));
    expect(first.status).toBe(201);
    expect(repeat).toMatchObject({ status: 200, body: { data: { created: false, turn: first.body.data.turn } } });
    expect((await stories.using(bench.db).require(storyId)).turnCount).toBe(3);

    // Hold the next turn inside the engine, then send a different one.
    bench.testMode.on = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    bench.ai.respond('wizard.askQuestion', async () => {
      await gate;
      return { question: 'Slow?', choices: [{ text: 'a' }, { text: 'b' }] };
    });
    const slow = turn(storyId, choice('A', 'route-key-0024'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const conflicting = await turn(storyId, choice('B', 'route-key-0025'));
    expect(conflicting).toMatchObject({ status: 409, body: { error: { code: 'TURN_CONFLICT' } } });
    const sameKey = await turn(storyId, choice('A', 'route-key-0024'));
    expect(sameKey).toMatchObject({ status: 409, body: { error: { code: 'TURN_IN_PROGRESS' } } });
    release();
    expect((await slow).status).toBe(201);
    expect((await turn(storyId, choice('A', 'route-key-0024'))).body.data.turn.promptDisplay).toBe('Slow?');
  });

  it('an expired claim does not block the next turn', async () => {
    const created = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0026' });
    const storyId = created.body.data.storyId as string;
    await stories.using(bench.db).update(storyId, { pendingTurn: { idempotencyKey: 'crashed-request', leaseUntil: Timestamp.fromMillis(NOW.getTime() - 1) } });
    expect((await turn(storyId, choice('A', 'route-key-0027'))).status).toBe(201);
  });
});

describe('abandon and finish', () => {
  it('abandons a story being created (idempotent) and refuses turns afterwards', async () => {
    const created = await create({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'route-key-0028' });
    const storyId = created.body.data.storyId as string;
    const abandon = () => call(abandonRoute(post(`/api/stories/${storyId}/abandon`), params({ storyId })));
    expect(await abandon()).toMatchObject({ status: 200, body: { data: { status: 'abandoned' } } });
    expect((await abandon()).status).toBe(200);
    expect((await turn(storyId, choice('A', 'route-key-0029'))).body.error.code).toBe('STORY_NOT_CREATING');
    expect((await call(finishRoute(post(`/api/stories/${storyId}/finish`), params({ storyId })))).body.error.code).toBe('STORY_NOT_FAILED');
    await bench.drain();
    expect(await ledgerUsed(bench.db)).toBe(0); // nothing charged for an abandoned story
  });
});
