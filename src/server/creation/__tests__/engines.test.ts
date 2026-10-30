import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { stories, storyTurns } from '../../data/repositories';
import { createStory, submitTurn, type StoryTurnResult } from '../service';
import { createBench, key, ledgerUsed, seed, user, type Bench } from './helpers';

const p1 = user('p1');
let bench: Bench;

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench({ testMode: true });
  await seed(bench.db);
});

async function start(modeId: 'wizard' | 'freeplay' | 'guided' | 'friends' | 'adventure', extra: Record<string, unknown> = {}) {
  return createStory(bench.services, p1, { childId: 'c1', modeId, idempotencyKey: key(), ...extra });
}

function choose(storyId: string, optionId: string) {
  return submitTurn(bench.services, p1, storyId, { input: { kind: 'choice', optionId }, idempotencyKey: key() });
}

async function finished(storyId: string) {
  await bench.drain();
  return stories.using(bench.db).require(storyId);
}

async function turnsOf(storyId: string) {
  return (await storyTurns.using(bench.db).of(storyId).where({})).sort((a, b) => a.index - b.index);
}

describe('wizard', () => {
  it('asks four questions, writes the story, and finishes through story.finish', async () => {
    const created = await start('wizard');
    expect(created).toMatchObject({ status: 'creating', created: true, turn: { index: 0, kind: 'prompt', expects: 'choice', progress: { step: 1, of: 4 } } });
    expect(created.turn.options).toHaveLength(3);
    expect(created.turn.options![1].text).toBe('Choice two with [[cast:c1]]');
    expect(created.turn.options![1].display).toBe('Choice two with Emma');

    let result: StoryTurnResult = created;
    for (let i = 0; i < 3; i++) {
      result = await choose(created.storyId, 'A');
      expect(result.turn).toMatchObject({ kind: 'prompt', progress: { step: i + 2, of: 4 } });
    }
    result = await choose(created.storyId, 'B');
    expect(result).toMatchObject({ status: 'finishing', turn: { kind: 'done' } });

    const story = await finished(created.storyId);
    expect(story).toMatchObject({ status: 'complete', title: "Emma's Big Day", modeId: 'wizard', turnCount: 9 });
    expect(story.text).toContain('[[cast:c1]]');
    expect(story.text).toContain('Choice two with [[cast:c1]]'); // the answers reached the story
    expect(story.synopsis).toBe('Emma has a wonderful adventure.');
    expect(story.allowance).toEqual({ charged: true, remaining: 0, reason: null });
    expect(await ledgerUsed(bench.db)).toBe(1);

    const turns = await turnsOf(created.storyId);
    expect(turns.map((t) => `${t.role}:${t.kind}`)).toEqual([
      'ai:prompt', 'child:input', 'ai:prompt', 'child:input', 'ai:prompt', 'child:input', 'ai:prompt', 'child:input', 'ai:done',
    ]);
    expect(turns[7].inputDisplay).toBe('Choice two with Emma');
    expect(story.modeState.answers).toHaveLength(4);
  });

  it('rejects input the prompt does not take (400 INPUT_NOT_EXPECTED) and keeps the story usable', async () => {
    const created = await start('wizard');
    await expect(choose(created.storyId, 'Z')).rejects.toMatchObject({ status: 400, code: 'INPUT_NOT_EXPECTED' });
    await expect(
      submitTurn(bench.services, p1, created.storyId, { input: { kind: 'castPick', castIds: ['c2'] }, idempotencyKey: key() })
    ).rejects.toMatchObject({ code: 'INPUT_NOT_EXPECTED' });
    const story = await stories.using(bench.db).require(created.storyId);
    expect(story.pendingTurn).toBeNull();
    expect((await choose(created.storyId, 'A')).turn.kind).toBe('prompt');
  });
});

describe('freeplay', () => {
  it('introduces a character from a chosen option: a story-origin character joins the cast with the turn', async () => {
    const created = await start('freeplay');
    expect(created.turn.promptDisplay).toBe('Hello Emma! Where shall we go today?');
    const reply = await choose(created.storyId, 'C');
    expect(reply.turn.addedCast).toHaveLength(1);
    const castId = reply.turn.addedCast[0];
    expect(castId).toMatch(/^chr_/);

    const character = (await bench.db.collection('characters').doc(castId).get()).data()!;
    expect(character).toMatchObject({
      ownerParentUid: 'p1',
      childId: 'c1',
      displayName: 'Bramble',
      type: 'Pet',
      origin: 'story',
      originStoryId: created.storyId,
      isParentGenerated: false,
      photos: [],
    });
    expect(character.avatarUrl).toBeUndefined(); // no stock placeholder (ADR-0006)

    const story = await stories.using(bench.db).require(created.storyId);
    expect(story.cast).toContainEqual({ castId, ref: { kind: 'character', id: castId }, role: 'supporting', addedBy: 'ai' });

    // Typed text is accepted too; the third prompt ends the story.
    const typed = await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'text', text: 'We fly!' }, idempotencyKey: key() });
    expect(typed.turn.kind).toBe('done');
    expect((await finished(created.storyId)).status).toBe('complete');
  });
});

describe('guided', () => {
  it('handles "tell me more", phases and progress, and finishes', async () => {
    const created = await start('guided');
    expect(created.turn).toMatchObject({ progress: { step: 1, of: 8 }, promptDisplay: 'What does Emma want to do today?' });
    expect(created.turn.options!.map((o) => o.id)).toEqual(['A', 'B', 'C', 'M']);
    const more = await choose(created.storyId, 'M');
    expect(more.turn.addedCast).toEqual([]);
    expect(more.turn.progress).toEqual({ step: 2, of: 8 });
    const done = await choose(created.storyId, 'A');
    expect(done.turn.kind).toBe('done');
    const story = await finished(created.storyId);
    expect(story.status).toBe('complete');
    expect(story.title).toBe("Emma's Story"); // no title hint: story.finish writes one
  });
});

describe('friends', () => {
  it('proposes companions, adds the picked ones to the cast, offers more synopses, and writes the story', async () => {
    const created = await start('friends', { castIds: ['ch1'] });
    expect(created.turn.expects).toBe('castPick');
    // Owner-scoped roster: Sam and Rex, not Sam's Pip, not the deleted child or another family's character.
    expect(created.turn.options!.map((o) => o.id)).toEqual(['c1', 'c2', 'ch1']);
    expect(created.turn.options!.map((o) => o.display)).toEqual(['Emma', 'Sam', 'Rex']);
    expect(created.turn.options!.every((o) => o.preselected)).toBe(true);

    await expect(
      submitTurn(bench.services, p1, created.storyId, { input: { kind: 'castPick', castIds: ['other1234567890xyz'] }, idempotencyKey: key() })
    ).rejects.toMatchObject({ code: 'INPUT_NOT_EXPECTED' });

    const picked = await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'castPick', castIds: ['c2'] }, idempotencyKey: key() });
    expect(picked.turn.addedCast).toEqual(['c2']);
    expect(picked.turn.options).toHaveLength(3);
    const story = await stories.using(bench.db).require(created.storyId);
    expect(story.cast.map((m) => [m.castId, m.addedBy])).toEqual([
      ['c1', 'setup'],
      ['ch1', 'setup'],
      ['c2', 'child'],
    ]);

    const synopses = await choose(created.storyId, 'A');
    expect(synopses.turn.options!.map((o) => o.id)).toEqual(['A', 'B', 'C', 'more']);
    expect(synopses.turn.options![0].display).toContain('Story idea 1A');
    const again = await choose(created.storyId, 'more');
    expect(again.turn.options![0].display).toContain('Story idea 2A');
    const done = await choose(created.storyId, 'B');
    expect(done.turn.kind).toBe('done');

    const complete = await finished(created.storyId);
    expect(complete.title).toBe('Story idea 2B');
    expect(complete.text).toContain('[[cast:c1]] and [[cast:c2]] found a rainbow bridge');
    // The final cast is who the story names: Rex (chosen at setup, unpicked) is not in it.
    expect(complete.cast.map((m) => m.castId)).toEqual(['c1', 'c2']);
  });
});

describe('adventure', () => {
  it('asks for a story type, follows the arc beat by beat, offers endings and compiles the chosen one', async () => {
    const created = await start('adventure');
    // Live story types for a six-year-old only.
    expect(created.turn.options!.map((o) => o.id)).toEqual(['quest']);

    let reply = await choose(created.storyId, 'quest');
    expect(reply.turn).toMatchObject({ kind: 'prompt', progress: { step: 1, of: 4 } });
    expect(reply.turn.promptDisplay).toContain('Emma took a brave step forward into part 1');
    let story = await stories.using(bench.db).require(created.storyId);
    expect(story.storyTypeId).toBe('quest');
    expect(story.modeState).toMatchObject({ phase: 'beat', arcStepIndex: 0, worldState: { presentCastIds: ['c1'], location: 'the whispering wood' } });

    reply = await choose(created.storyId, 'C'); // introduces Moss
    expect(reply.turn.progress).toEqual({ step: 2, of: 4 });
    expect(reply.turn.addedCast).toHaveLength(1);
    story = await stories.using(bench.db).require(created.storyId);
    expect(story.cast.find((m) => m.addedBy === 'ai')?.castId).toBe(reply.turn.addedCast[0]);
    reply = await choose(created.storyId, 'A');
    expect(reply.turn.progress).toEqual({ step: 3, of: 4 });
    reply = await choose(created.storyId, 'B'); // past the last arc step → endings
    expect(reply.turn).toMatchObject({ promptDisplay: 'How should the story end?', progress: { step: 4, of: 4 } });
    expect(reply.turn.options!.map((o) => o.display)).toContain('Emma flew home on a friendly cloud.');

    reply = await choose(created.storyId, 'B');
    expect(reply).toMatchObject({ status: 'finishing', turn: { kind: 'done' } });
    story = await finished(created.storyId);
    expect(story.status).toBe('complete');
    expect(story.text).toContain('part 1 of the adventure');
    expect(story.text).toContain('part 3 of the adventure');
    expect(story.text!.endsWith('[[cast:c1]] flew home on a friendly cloud.')).toBe(true);
    // The fixture text never names Moss again, so the final cast is the hero alone.
    expect(story.cast.map((m) => m.castId)).toEqual(['c1']);
  });

  it('can start straight on the first beat when the story type is given', async () => {
    const created = await start('adventure', { storyTypeId: 'quest' });
    expect(created.turn.progress).toEqual({ step: 1, of: 4 });
    await expect(start('adventure', { storyTypeId: 'draft' })).rejects.toMatchObject({ code: 'STORY_TYPE_NOT_FOUND' });
    await expect(start('wizard', { storyTypeId: 'quest' })).rejects.toMatchObject({ status: 400 });
  });
});
