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
  return { ...actual, getCreationServiceDeps: async () => bench.services, getCreationReadDb: async () => bench.db };
});

import { UnauthenticatedError } from '../../errors';
import { GET as listRoute } from '@/app/api/stories/route';
import { GET as getRoute } from '@/app/api/stories/[storyId]/route';
import { GET as modesRoute } from '@/app/api/creation-modes/route';
import { abandonStory, createStory, submitTurn } from '../service';
import { createBench, key, seed, user } from './helpers';

const p1 = user('p1');

function get(path: string) {
  return new Request(`https://app.test${path}`, { method: 'GET' });
}

async function call(response: Promise<Response>) {
  const res = await response;
  return { status: res.status, body: await res.json() };
}

const list = (childId: string) => call(listRoute(get(`/api/stories?childId=${childId}`)));
const read = (storyId: string) => call(getRoute(get(`/api/stories/${storyId}`), { params: Promise.resolve({ storyId }) }));

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  verifyUserToken.mockReset();
  verifyUserToken.mockResolvedValue(p1);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench({ testMode: true });
  await seed(bench.db);
});

async function finishedWizardStory(): Promise<string> {
  const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });
  for (let i = 0; i < 4; i++) {
    await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: key() });
  }
  await bench.drain();
  return created.storyId;
}

describe('GET /api/stories and /api/stories/{id}', () => {
  it('require a user token and validate the child', async () => {
    verifyUserToken.mockRejectedValue(new UnauthenticatedError('Missing ID token'));
    expect((await list('c1')).status).toBe(401);
    expect((await read('x')).status).toBe(401);
    expect((await call(modesRoute(get('/api/creation-modes')))).status).toBe(401);
    verifyUserToken.mockResolvedValue(p1);
    expect((await list('')).status).toBe(400);
    expect((await list('nope')).body.error.code).toBe('CHILD_NOT_FOUND');
    expect((await read('missing')).body.error.code).toBe('STORY_NOT_FOUND');
  });

  it("list the child's Stories newest first with names, leave abandoned ones out, and deny other families", async () => {
    // The free tier has one story: start the others before one completes.
    const creating = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });
    const abandoned = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });
    await abandonStory(bench.services, p1, abandoned.storyId);
    const done = await finishedWizardStory();

    const response = await list('c1');
    expect(response.status).toBe(200);
    const ids = response.body.data.stories.map((s: { id: string }) => s.id);
    expect(new Set(ids)).toEqual(new Set([done, creating.storyId]));
    const complete = response.body.data.stories.find((s: { id: string }) => s.id === done);
    expect(complete).toMatchObject({ status: 'complete', modeId: 'wizard', childId: 'c1', title: "Emma's Big Day" });
    expect(complete.text).toContain('Emma');
    expect(complete.text).not.toContain('[[cast:');
    expect(complete.cast[0]).toMatchObject({ castId: 'c1', role: 'hero', displayName: 'Emma', kind: 'child' });
    expect(response.body.data.stories.find((s: { id: string }) => s.id === creating.storyId)).toMatchObject({ status: 'creating', text: null, title: null });

    verifyUserToken.mockResolvedValue(user('p2'));
    expect((await list('c1')).status).toBe(403);
    expect((await read(done)).status).toBe(403);
  });

  it('return one Story with its turns as the child sees them, and apply the persona scope', async () => {
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });
    await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'B' }, idempotencyKey: key() });
    const response = await read(created.storyId);
    expect(response.status).toBe(200);
    const { story, turns } = response.body.data;
    expect(story).toMatchObject({ id: created.storyId, status: 'creating', turnCount: 3 });
    expect(turns.map((t: { index: number; kind: string }) => [t.index, t.kind])).toEqual([
      [0, 'prompt'],
      [1, 'input'],
      [2, 'prompt'],
    ]);
    expect(turns[0]).toMatchObject({ role: 'ai', expects: 'choice' });
    expect(turns[0].options[0]).toEqual({ id: expect.any(String), display: expect.any(String), preselected: false });
    expect(turns[0]).not.toHaveProperty('prompt');
    expect(turns[1].inputDisplay).toBeTruthy();

    enforcePersonaScope.mockResolvedValue({ ok: false, status: 403, code: 'PERSONA_SCOPE_MISMATCH', message: 'mismatch' });
    expect((await read(created.storyId)).body.error.code).toBe('PERSONA_SCOPE_MISMATCH');
    expect((await list('c1')).body.error.code).toBe('PERSONA_SCOPE_MISMATCH');
  });

  it('treat a document written by the retired flows as not found', async () => {
    await bench.db.collection('stories').doc('legacy1').set({ parentUid: 'p1', childId: 'c1', storyText: 'Once.' });
    expect((await read('legacy1')).body.error.code).toBe('STORY_NOT_FOUND');
    expect((await list('c1')).body.data.stories).toEqual([]);
  });
});

describe('GET /api/creation-modes', () => {
  it('lists live modes enabled for kids, kid-safe, with exactly one recommended', async () => {
    const response = await call(modesRoute(get('/api/creation-modes')));
    expect(response.status).toBe(200);
    const modes = response.body.data.modes as Array<{ modeId: string; name: string; recommended: boolean }>;
    // beat (adventure) is not enabled for kids in the seed.
    expect(modes.map((m) => m.modeId).sort()).toEqual(['freeplay', 'friends', 'guided', 'wizard']);
    expect(modes.filter((m) => m.recommended).map((m) => m.modeId)).toEqual(['wizard']);
    expect(modes.map((m) => m.name).join(' ')).not.toMatch(/gemini/i);
    expect(modes[0]).not.toHaveProperty('prompts');

    await bench.db.collection('storyGenerators').doc('wizard').set({ status: 'draft', enabledForKids: true }, { merge: true });
    const later = (await call(modesRoute(get('/api/creation-modes')))).body.data.modes as Array<{ modeId: string; recommended: boolean }>;
    expect(later.map((m) => m.modeId)).not.toContain('wizard');
    expect(later.filter((m) => m.recommended)).toHaveLength(1);
  });
});
