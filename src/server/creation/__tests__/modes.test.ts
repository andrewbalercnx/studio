import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { creationModeFromGenerator, listCreationModes, loadCreationMode, MODE_SOURCE_IDS, modeAvailability, modeIdForSource, temperatureFor } from '../modes';
import { listStoryTypesForAge, normalizeArcSteps } from '../story-types';

describe('CreationMode adapter over storyGenerators', () => {
  it('maps the five surviving modes onto their documents', () => {
    expect(MODE_SOURCE_IDS).toEqual({ wizard: 'wizard', freeplay: 'gemini3', guided: 'gemini4', friends: 'friends', adventure: 'beat' });
    expect(modeIdForSource('gemini3')).toBe('freeplay');
    expect(modeIdForSource('chat')).toBeNull();
  });

  it('exposes prompts, the creation.text override, temperatures, kid presentation and status', () => {
    const mode = creationModeFromGenerator('friends', 'friends', {
      name: 'Gemini Friends',
      description: 'Uses Gemini to write',
      status: 'live',
      enabledForKids: true,
      prompts: { storyGeneration: 'Write!', empty: '  ' },
      defaultModel: 'googleai/gemini-2.5-flash',
      defaultTemperature: 0.5,
      promptConfig: { scenarioGeneration: { model: 'googleai/gemini-2.0-flash', temperature: 1.1 } },
      styling: { icon: 'Users', gradient: 'g', loadingMessage: 'Gemini is thinking' },
    });
    expect(mode).toMatchObject({
      modeId: 'friends',
      status: 'live',
      enabledForKids: true,
      prompts: { storyGeneration: 'Write!' },
      model: 'googleai/gemini-2.5-flash',
      temperature: 0.5,
      promptTemperatures: { scenarioGeneration: 1.1 },
      presentation: { name: 'Fun with my friends', icon: 'Users', recommended: false },
    });
    expect(mode.presentation.loadingMessage).not.toMatch(/gemini/i);
    expect(temperatureFor(mode, 'scenarioGeneration', 1.2)).toBe(1.1);
    expect(temperatureFor(mode, 'storyGeneration', 0.7)).toBe(0.5);
  });

  it('decides availability: live for everyone; enabledForKids under a child persona; drafts for admins only', () => {
    const base = creationModeFromGenerator('adventure', 'beat', { status: 'live' });
    expect(modeAvailability(base, { privileged: false, childPersona: false })).toEqual({ ok: true });
    expect(modeAvailability(base, { privileged: false, childPersona: true })).toMatchObject({ ok: false, code: 'MODE_NOT_FOR_KIDS' });
    const draft = creationModeFromGenerator('wizard', 'wizard', { status: 'draft', enabledForKids: true });
    expect(modeAvailability(draft, { privileged: false, childPersona: false })).toMatchObject({ ok: false, code: 'MODE_NOT_LIVE' });
    expect(modeAvailability(draft, { privileged: true, childPersona: false })).toEqual({ ok: true });
  });

  it('loads and lists from Firestore with one recommended mode', async () => {
    const db = new FakeFirestore().asFirestore();
    await db.collection('storyGenerators').doc('wizard').set({ status: 'live', enabledForKids: true, name: 'Story Wizard', order: 2 });
    await db.collection('storyGenerators').doc('gemini3').set({ status: 'live', enabledForKids: true, name: 'Gemini Free', order: 1 });
    await db.collection('storyGenerators').doc('chat').set({ status: 'live', enabledForKids: true });
    expect(await loadCreationMode(db, 'guided')).toBeNull();
    const modes = await listCreationModes(db);
    expect(modes.map((m) => [m.modeId, m.presentation.recommended])).toEqual([
      ['freeplay', false],
      ['wizard', true],
    ]);
  });

  it('reads StoryTypes for an age and normalises string arc steps', async () => {
    expect(normalizeArcSteps(['go_home', { id: 'x', label: 'X', suggestsNewCharacter: true }, 3])).toEqual([
      { id: 'go_home', label: 'Go Home' },
      { id: 'x', label: 'X', guidance: undefined, suggestsNewCharacter: true },
    ]);
    const db = new FakeFirestore().asFirestore();
    await db.collection('storyTypes').doc('a').set({ name: 'B type', status: 'live', ageFrom: 3, ageTo: 6 });
    await db.collection('storyTypes').doc('b').set({ name: 'A type', status: 'live' });
    await db.collection('storyTypes').doc('c').set({ name: 'C', status: 'draft' });
    expect((await listStoryTypesForAge(db, 8)).map((t) => t.storyTypeId)).toEqual(['b']);
    expect((await listStoryTypesForAge(db, null)).map((t) => t.storyTypeId)).toEqual(['b', 'a']);
  });
});
