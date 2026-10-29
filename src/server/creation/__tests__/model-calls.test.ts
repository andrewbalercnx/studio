import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import { stories } from '../../data/repositories';
import { createStory, submitTurn } from '../service';
import { createBench, key, seed, user, type Bench } from './helpers';

const p1 = user('p1');
let bench: Bench;

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  bench = createBench({ testMode: false });
  await seed(bench.db);
});

const question = (q: string) => ({ question: q, choices: [{ text: 'Yes' }, { text: 'No' }] });

describe('model calls (no TEST_MODE)', () => {
  it('reads curated prompts and the creation.text override from the mode config, and stores tokens owner-scoped', async () => {
    await bench.db.collection('storyGenerators').doc('wizard').set({
      status: 'live',
      enabledForKids: true,
      defaultModel: 'googleai/gemini-2.5-flash',
      prompts: { questionGeneration: 'Q! {{ageDescription}} Hero is $$CHILD_ID_PLACEHOLDER$$. Use $$id$$ tokens.\n{{context}}' },
    });
    bench.ai.respond('wizard.askQuestion', question('Does $$c1$$ like $$other1234567890xyz$$ or $$Rex$$ or $$Bramble$$?'));
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });

    const call = bench.ai.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ purpose: 'creation.text', creationModeModel: 'googleai/gemini-2.5-flash', flowName: 'wizard.askQuestion', ownerUid: 'p1' });
    const prompt = String(call.prompt);
    expect(prompt).toContain('Q! The child is 6 years old. Hero is [[cast:c1]]. Use [[cast:id]] tokens.');
    expect(prompt).toContain('[[cast:c2]] (display name: "Sam")');
    expect(prompt).toContain('[[cast:ch1]] (display name: "Rex", type: Pet)');
    expect(prompt).not.toContain('Stranger'); // another family's character is never offered
    expect(prompt).not.toContain('Pip'); // scoped to Sam, not Emma

    expect(created.turn.prompt).toBe('Does [[cast:c1]] like a friend or [[cast:ch1]] or Bramble?');
    expect(created.turn.promptDisplay).toBe('Does Emma like a friend or Rex or Bramble?');
  });

  it('a model failure is a 503 the child can retry; the claim is released', async () => {
    bench.ai.respond('wizard.askQuestion', question('Ready?'));
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'wizard', idempotencyKey: key() });
    bench.ai.respond('wizard.askQuestion', new Error('upstream 500'));
    const turnKey = key();
    await expect(
      submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: turnKey })
    ).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
    expect((await stories.using(bench.db).require(created.storyId)).pendingTurn).toBeNull();

    bench.ai.respond('wizard.askQuestion', question('Again?'));
    const retried = await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: turnKey });
    expect(retried.turn.promptDisplay).toBe('Again?');
  });

  it('freeplay: a profile is generated for an introduced character', async () => {
    bench.ai.respond('freeplay.respond', {
      question: 'Who do you meet?',
      options: [
        { id: 'A', text: 'A dragon', introducesCharacter: true, newCharacterName: 'Ember', newCharacterLabel: 'a tiny dragon who loves tea', newCharacterType: 'pet' },
        { id: 'B', text: 'Nobody' },
      ],
      isStoryComplete: false,
    });
    bench.ai.respond('freeplay.characterProfile', { description: 'A tiny tea-loving dragon.', age: 7, pronouns: 'she/her', likes: ['tea'], dislikes: ['cold'] });
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'freeplay', idempotencyKey: key() });
    expect(String((bench.ai.mock.calls[0][0] as Record<string, unknown>).prompt)).toContain('Welcome the child warmly');

    const reply = await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId: 'A' }, idempotencyKey: key() });
    const character = (await bench.db.collection('characters').doc(reply.turn.addedCast[0]).get()).data()!;
    expect(character).toMatchObject({ displayName: 'Ember', type: 'Pet', pronouns: 'she/her', description: 'A tiny tea-loving dragon.', likes: ['tea'] });
    expect(character.dateOfBirth).toBeNull(); // pets get no age
    // The second call saw the conversation and the new character in the cast.
    const second = String((bench.ai.mock.calls.at(-1)![0] as Record<string, unknown>).prompt);
    expect(second).toContain('Gemini: Who do you meet?');
    expect(second).toContain('Child: A dragon');
    expect(second).toContain(`[[cast:${reply.turn.addedCast[0]}]] (display name: "Ember"`);
  });

  it('adventure: StoryType prompts drive the beat; the polish keeps tokens even when the model writes names', async () => {
    bench.ai.respond('adventure.beat', {
      storyContinuation: '$$c1$$ set off with $$ch1$$.',
      scene: { presentActors: ['$$c1$$', 'ch1'], location: 'a hill' },
      options: [{ id: 'A', text: 'Go up' }, { id: 'B', text: 'Go down' }, { id: 'C', text: 'Rest' }],
    });
    bench.ai.respond('adventure.endings', { endings: [{ id: 'A', text: 'Home again.' }, { id: 'B', text: 'A picnic.' }, { id: 'C', text: 'Stars.' }] });
    bench.ai.respond('adventure.compile', { storyText: 'Emma and Rex climbed the hill together, laughing all the way up. Then they had a picnic.', synopsis: 'Emma and Rex climb a hill.' });
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'adventure', storyTypeId: 'quest', idempotencyKey: key() });
    const beatCall = bench.ai.mock.calls[0][0] as Record<string, unknown>;
    expect(beatCall.config).toMatchObject({ temperature: 0.6, maxOutputTokens: 10000 });
    expect(String(beatCall.prompt)).toContain('You are a quest guide.');
    expect(String(beatCall.prompt)).toContain('Arc Step: setup (Setup)');

    const story0 = await stories.using(bench.db).require(created.storyId);
    expect(story0.modeState.worldState).toEqual({ presentCastIds: ['c1', 'ch1'], location: 'a hill' });

    const step = (optionId: string) => submitTurn(bench.services, p1, created.storyId, { input: { kind: 'choice', optionId }, idempotencyKey: key() });
    await step('A');
    const second = bench.ai.mock.calls.at(-1)![0] as { system: string; messages: Array<{ role: string }> };
    expect(second.system).toContain('CHARACTER INTRODUCTION OPPORTUNITY'); // arc step "meet" suggests a new character
    expect(second.system).toContain('=== CURRENT WORLD STATE ===');
    expect(second.messages.map((m) => m.role)).toEqual(['model', 'user']);
    await step('A');
    const endings = await step('A');
    expect(endings.turn.promptDisplay).toBe('How should the story end?');
    const done = await step('B');
    expect(done.turn.kind).toBe('done');
    const story = await stories.using(bench.db).require(created.storyId);
    expect(story.text).toBe('[[cast:c1]] and [[cast:ch1]] climbed the hill together, laughing all the way up. Then they had a picnic.');
    expect(story.cast.map((m) => m.castId)).toEqual(['c1', 'ch1']);
  });

  it('story.finish asks for a synopsis and a title (quotes stripped) and completes', async () => {
    bench.ai.respond('guided.respond', {
      question: '',
      options: [],
      isStoryComplete: false,
      finalStory: '',
      questionPhase: 'opening',
    });
    bench.ai.respond('guided.respond', () => ({ question: 'Go?', options: [], isStoryComplete: false, finalStory: '', questionPhase: 'opening' }));
    const created = await createStory(bench.services, p1, { childId: 'c1', modeId: 'guided', idempotencyKey: key() });
    expect(created.turn.expects).toBe('text');
    bench.ai.respond('guided.respond', { question: '', options: [], isStoryComplete: true, finalStory: '$$c1$$ went to the moon and back.', questionPhase: 'complete' });
    bench.ai.respond('story.finish.synopsis', 'Emma visits the moon and comes home');
    bench.ai.respond('story.finish.title', '"Moon Trip"');
    await submitTurn(bench.services, p1, created.storyId, { input: { kind: 'text', text: 'To the moon!' }, idempotencyKey: key() });
    await bench.drain();
    const story = await stories.using(bench.db).require(created.storyId);
    expect(story).toMatchObject({ status: 'complete', title: 'Moon Trip', synopsis: 'Emma visits the moon and comes home.', text: '[[cast:c1]] went to the moon and back.' });
    const synopsisCall = bench.ai.mock.calls.find(([o]) => (o as { flowName: string }).flowName === 'story.finish.synopsis')![0] as { prompt: string };
    expect(synopsisCall.prompt).toContain('Emma went to the moon and back.'); // names resolved for the summary
  });
});
