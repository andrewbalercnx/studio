import { describe, it, expect } from 'vitest';
import {
  presentGeneratorsForKids,
  scrubModelJargon,
  containsModelJargon,
  sortGenerators,
} from '@/lib/kids-generator-presentation';
import type { StoryGenerator } from '@/lib/types';

function makeGenerator(overrides: Partial<StoryGenerator> & { id: string }): StoryGenerator {
  return {
    name: overrides.id,
    description: 'desc',
    status: 'live',
    capabilities: {
      minChoices: 2,
      maxChoices: 4,
      supportsMoreOptions: false,
      supportsCharacterIntroduction: false,
      supportsFinalStory: true,
      requiresStoryType: false,
    },
    apiEndpoint: `/api/${overrides.id}`,
    styling: {
      gradient: 'from-amber-50 to-orange-50',
      loadingMessage: 'Loading...',
    },
    enabledForKids: true,
    ...overrides,
  } as StoryGenerator;
}

describe('scrubModelJargon', () => {
  it('strips model names from labels', () => {
    expect(scrubModelJargon('Gemini Free')).toBe('Free');
    expect(scrubModelJargon('Powered by GPT-4 magic')).toBe('Powered by magic');
    expect(scrubModelJargon('Claude Story Time')).toBe('Story Time');
  });

  it('returns the fallback when nothing is left', () => {
    expect(scrubModelJargon('Gemini', 'Story Adventure')).toBe('Story Adventure');
  });

  it('leaves clean labels alone', () => {
    expect(scrubModelJargon('Story Wizard')).toBe('Story Wizard');
    expect(scrubModelJargon('Fun with my friends')).toBe('Fun with my friends');
  });
});

describe('containsModelJargon', () => {
  it('detects jargon regardless of position or case', () => {
    expect(containsModelJargon('gemini is crafting your story...')).toBe(true);
    expect(containsModelJargon('Uses the OpenAI API')).toBe(true);
    expect(containsModelJargon('The wizard is thinking...')).toBe(false);
  });

  it('is stateful-regex safe (repeat calls give the same answer)', () => {
    expect(containsModelJargon('Gemini Free')).toBe(true);
    expect(containsModelJargon('Gemini Free')).toBe(true);
  });
});

describe('presentGeneratorsForKids', () => {
  it('hides model jargon in built-in generator names and descriptions', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({
        id: 'gemini3',
        name: 'Gemini Free',
        description: 'Open-ended creative story generation with full AI freedom.',
        styling: { gradient: 'g', loadingMessage: 'Gemini is crafting your story...' },
      }),
    ]);

    expect(result[0].name).toBe('Free Play');
    expect(containsModelJargon(result[0].name)).toBe(false);
    expect(containsModelJargon(result[0].description)).toBe(false);
    expect(containsModelJargon(result[0].styling?.loadingMessage ?? '')).toBe(false);
  });

  it('scrubs jargon from unknown generators as a fallback', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({ id: 'newgen', name: 'GPT-5 Turbo Stories', description: 'Stories via GPT-5 Turbo.' }),
    ]);
    expect(containsModelJargon(result[0].name)).toBe(false);
    expect(containsModelJargon(result[0].description)).toBe(false);
    expect(result[0].name).not.toBe('');
  });

  it('strips internal fields (prompts, model config, endpoints)', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({
        id: 'wizard',
        prompts: { questionGeneration: 'SECRET PROMPT' },
        defaultModel: 'googleai/gemini-2.5-pro',
        defaultTemperature: 1.2,
        promptConfig: { storyGeneration: { temperature: 0.5 } },
      } as any),
    ]);

    const view = result[0] as Record<string, unknown>;
    expect(view.prompts).toBeUndefined();
    expect(view.defaultModel).toBeUndefined();
    expect(view.defaultTemperature).toBeUndefined();
    expect(view.promptConfig).toBeUndefined();
    expect(view.apiEndpoint).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('SECRET PROMPT');
    expect(JSON.stringify(view)).not.toContain('gemini-2.5-pro');
  });

  it('marks exactly one generator as recommended (wizard by default)', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({ id: 'gemini3', name: 'Gemini Free' }),
      makeGenerator({ id: 'wizard', name: 'Story Wizard' }),
      makeGenerator({ id: 'friends', name: 'Fun with my friends' }),
    ]);

    const recommended = result.filter(g => g.recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0].id).toBe('wizard');
  });

  it('honours an explicit admin recommendedForKids flag over the wizard default', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({ id: 'wizard' }),
      makeGenerator({ id: 'friends', recommendedForKids: true } as any),
    ]);

    expect(result.find(g => g.id === 'friends')?.recommended).toBe(true);
    expect(result.filter(g => g.recommended)).toHaveLength(1);
  });

  it('falls back to the first generator by order when wizard is absent', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({ id: 'gemini3', order: 2 }),
      makeGenerator({ id: 'friends', order: 1 }),
    ]);

    expect(result[0].id).toBe('friends');
    expect(result[0].recommended).toBe(true);
    expect(result.filter(g => g.recommended)).toHaveLength(1);
  });

  it('honours admin kidFriendlyName/kidFriendlyDescription overrides first', () => {
    const result = presentGeneratorsForKids([
      makeGenerator({
        id: 'gemini3',
        name: 'Gemini Free',
        kidFriendlyName: 'Magic Mode',
        kidFriendlyDescription: 'Totally custom copy.',
      } as any),
    ]);

    expect(result[0].name).toBe('Magic Mode');
    expect(result[0].description).toBe('Totally custom copy.');
  });

  it('returns an empty list for empty input', () => {
    expect(presentGeneratorsForKids([])).toEqual([]);
  });
});

describe('sortGenerators', () => {
  it('sorts by order then id, without mutating the input', () => {
    const input = [
      { id: 'b', order: 2 },
      { id: 'c', order: 1 },
      { id: 'a', order: 2 },
    ];
    const sorted = sortGenerators(input);
    expect(sorted.map(g => g.id)).toEqual(['c', 'a', 'b']);
    expect(input.map(g => g.id)).toEqual(['b', 'c', 'a']);
  });
});
