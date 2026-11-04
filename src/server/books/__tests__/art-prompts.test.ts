import { describe, expect, it } from 'vitest';
import { buildPagePrompt, type PresentMember } from '../art-prompts';
import type { CastEntry } from '../cast';
import type { Scene } from '../../data/schemas/manuscript';

function member(overrides: Partial<CastEntry> = {}): CastEntry {
  return {
    castId: 'c1',
    ref: { kind: 'child', id: 'c1' },
    role: 'hero',
    addedBy: 'setup',
    displayName: 'Emma',
    pronouns: 'she/her',
    namePronunciation: null,
    description: 'a brave explorer',
    characterType: null,
    likes: [],
    age: '5 years old',
    preferredVoiceId: null,
    likeness: { portrait: null, appearance: 'curly brown hair and blue eyes', photos: [] },
    ...overrides,
  };
}

const scene: Scene = {
  location: 'a sunny garden',
  presentCast: ['c1'],
  action: 'Emma plants flowers',
  locationKey: 'garden',
  mood: 'bright',
  tag: 'outdoor-day',
  castActions: [{ castId: 'c1', action: 'planting flowers' }],
};

function present(member: CastEntry): PresentMember {
  return { member, action: 'planting flowers', referenceImage: 5, referenceKind: 'castSheet' };
}

describe('buildPagePrompt', () => {
  it('names the cast once (no separate JSON block) and carries their details into the scene list', () => {
    const prompt = buildPagePrompt({
      kind: 'story',
      scene,
      present: [present(member())],
      stylePrompt: 'soft watercolour',
      styleImageCount: 1,
      globalPrefix: null,
      title: null,
      heroName: 'Emma',
      heroAge: '5 years old',
      level: 'full',
    });
    // One bullet carrying the action and the appearance, not a second JSON dump.
    expect(prompt).toContain('• Emma (main character, she/her): planting flowers');
    expect(prompt).toContain('Appearance: curly brown hair and blue eyes');
    expect(prompt).not.toContain('"appearance"'); // the old JSON block is gone
    expect(prompt.match(/• Emma \(/g)?.length).toBe(1); // listed as a cast bullet exactly once
  });

  it("uses the character's pronouns, defaulting to they/them", () => {
    const he = buildPagePrompt({
      kind: 'story', scene, present: [present(member({ pronouns: 'he/him', displayName: 'Sam' }))],
      stylePrompt: 's', styleImageCount: 0, globalPrefix: null, title: null, heroName: 'Sam', heroAge: null, level: 'full',
    });
    expect(he).toContain('(main character, he/him)');

    const none = buildPagePrompt({
      kind: 'story', scene, present: [present(member({ pronouns: null, displayName: 'Robin' }))],
      stylePrompt: 's', styleImageCount: 0, globalPrefix: null, title: null, heroName: 'Robin', heroAge: null, level: 'full',
    });
    expect(none).toContain('(main character, they/them)');
  });

  it('keeps the minimal level terse (name and action only)', () => {
    const prompt = buildPagePrompt({
      kind: 'story', scene, present: [present(member())],
      stylePrompt: 's', styleImageCount: 1, globalPrefix: null, title: null, heroName: 'Emma', heroAge: null, level: 'minimal',
    });
    expect(prompt).toContain('• Emma: planting flowers');
    expect(prompt).not.toContain('Appearance:');
  });
});
