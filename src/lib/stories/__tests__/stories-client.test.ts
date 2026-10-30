import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetch = vi.fn();
vi.mock('@/lib/auth-fetch', () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import {
  abandonStory,
  createStory,
  getStory,
  isRetryLater,
  kidSafeMessage,
  listCreationModes,
  listStories,
  retryFinish,
  sendTurn,
  StoryApiError,
} from '../api';
import { currentPrompt, storyStatusLabel, type TurnDoc } from '../types';

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function turn(index: number, role: TurnDoc['role'], kind: TurnDoc['kind']): TurnDoc {
  return { id: String(index), ownerUid: 'p1', index, role, kind, promptDisplay: null, options: null, expects: null, progress: null, inputDisplay: null };
}

describe('story API calls', () => {
  beforeEach(() => authFetch.mockReset());

  it('post to the creation routes with the idempotency key and unwrap the envelope', async () => {
    authFetch.mockResolvedValue(respond(201, { ok: true, data: { storyId: 'st_1', status: 'creating', turn: { index: 0 }, created: true } }));
    const created = await createStory({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'key-123456' });
    expect(created.storyId).toBe('st_1');
    expect(authFetch).toHaveBeenLastCalledWith('/api/stories', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({ childId: 'c1', modeId: 'wizard', idempotencyKey: 'key-123456' });

    await sendTurn('st_1', { kind: 'choice', optionId: 'A' }, 'key-abcdefgh');
    expect(authFetch.mock.calls[1][0]).toBe('/api/stories/st_1/turns');
    expect(JSON.parse(authFetch.mock.calls[1][1].body)).toEqual({ input: { kind: 'choice', optionId: 'A' }, idempotencyKey: 'key-abcdefgh' });

    await abandonStory('st_1');
    await retryFinish('st_1');
    expect(authFetch.mock.calls.slice(2).map((c) => c[0])).toEqual(['/api/stories/st_1/abandon', '/api/stories/st_1/finish']);
  });

  it('read the lists and the story through GET', async () => {
    authFetch.mockResolvedValueOnce(respond(200, { ok: true, data: { stories: [{ id: 'st_1' }] } }));
    expect(await listStories('c 1')).toEqual([{ id: 'st_1' }]);
    expect(authFetch.mock.calls[0][0]).toBe('/api/stories?childId=c%201');
    authFetch.mockResolvedValueOnce(respond(200, { ok: true, data: { story: { id: 'st_1' }, turns: [] } }));
    expect((await getStory('st_1')).story.id).toBe('st_1');
    authFetch.mockResolvedValueOnce(respond(200, { ok: true, data: { modes: [{ modeId: 'wizard' }] } }));
    expect(await listCreationModes()).toEqual([{ modeId: 'wizard' }]);
  });

  it('turn failures into StoryApiError with the server code; a network failure is code NETWORK', async () => {
    authFetch.mockResolvedValueOnce(respond(409, { ok: false, error: { code: 'TURN_IN_PROGRESS', message: 'busy' } }));
    const error = await sendTurn('st_1', { kind: 'text', text: 'hi' }, 'key-abcdefgh').catch((e) => e);
    expect(error).toBeInstanceOf(StoryApiError);
    expect(error).toMatchObject({ code: 'TURN_IN_PROGRESS', status: 409 });
    expect(isRetryLater(error)).toBe(true);

    authFetch.mockRejectedValueOnce(new TypeError('offline'));
    const offline = await listCreationModes().catch((e) => e);
    expect(offline).toMatchObject({ code: 'NETWORK', status: 0 });
    expect(isRetryLater(offline)).toBe(true);
    expect(isRetryLater(new StoryApiError('x', 'TURN_CONFLICT', 409))).toBe(false);
  });
});

describe('kid-safe messages', () => {
  it('pass through the server copy written for children and hide everything else', () => {
    expect(kidSafeMessage(new StoryApiError("You've used all your stories.", 'ENTITLEMENT_LIMIT', 402))).toBe("You've used all your stories.");
    expect(kidSafeMessage(new StoryApiError('model exploded', 'AI_UNAVAILABLE', 503))).not.toContain('model');
    expect(kidSafeMessage(new StoryApiError('Internal server error', 'INTERNAL', 500))).not.toContain('Internal');
    expect(kidSafeMessage(new Error('Firestore permission-denied'))).not.toContain('Firestore');
  });
});

describe('current prompt', () => {
  it('is the newest AI prompt, and none while the newest turn is the child’s or the story is done', () => {
    expect(currentPrompt([])).toBeNull();
    expect(currentPrompt([turn(0, 'ai', 'prompt')])?.index).toBe(0);
    expect(currentPrompt([turn(2, 'ai', 'prompt'), turn(0, 'ai', 'prompt'), turn(1, 'child', 'input')])?.index).toBe(2);
    expect(currentPrompt([turn(0, 'ai', 'prompt'), turn(1, 'child', 'input')])).toBeNull();
    expect(currentPrompt([turn(0, 'ai', 'prompt'), turn(1, 'child', 'input'), turn(2, 'ai', 'done')])).toBeNull();
  });

  it('labels every status for children', () => {
    expect(storyStatusLabel('complete')).toBe('Story ready');
    expect(storyStatusLabel('creating')).toBe('Still being made');
  });
});
