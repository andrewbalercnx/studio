import { describe, it, expect } from 'vitest';
import {
  SCENE_EXEMPLAR_TAGS,
  DEFAULT_SCENE_EXEMPLAR_DEFINITIONS,
} from '@/lib/scene-exemplar-config';

describe('SCENE_EXEMPLAR_TAGS', () => {
  it('has exactly 4 entries', () => {
    expect(SCENE_EXEMPLAR_TAGS).toHaveLength(4);
  });

  it('contains all expected tag values', () => {
    expect(SCENE_EXEMPLAR_TAGS).toContain('indoor-day');
    expect(SCENE_EXEMPLAR_TAGS).toContain('outdoor-day');
    expect(SCENE_EXEMPLAR_TAGS).toContain('indoor-night');
    expect(SCENE_EXEMPLAR_TAGS).toContain('outdoor-night');
  });
});

describe('DEFAULT_SCENE_EXEMPLAR_DEFINITIONS', () => {
  it('has one definition per tag', () => {
    expect(DEFAULT_SCENE_EXEMPLAR_DEFINITIONS).toHaveLength(SCENE_EXEMPLAR_TAGS.length);
  });

  it('each definition has all required fields as non-empty strings', () => {
    for (const def of DEFAULT_SCENE_EXEMPLAR_DEFINITIONS) {
      expect(def.tag).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.generationPrompt).toBeTruthy();
    }
  });

  it('definition tags match SCENE_EXEMPLAR_TAGS exactly', () => {
    const defTags = DEFAULT_SCENE_EXEMPLAR_DEFINITIONS.map(d => d.tag);
    for (const tag of SCENE_EXEMPLAR_TAGS) {
      expect(defTags).toContain(tag);
    }
  });

  it('generationPrompts are substantive (> 20 chars each)', () => {
    for (const def of DEFAULT_SCENE_EXEMPLAR_DEFINITIONS) {
      expect(def.generationPrompt.length).toBeGreaterThan(20);
    }
  });

  it('all descriptions are distinct', () => {
    const descriptions = DEFAULT_SCENE_EXEMPLAR_DEFINITIONS.map(d => d.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('all generationPrompts are distinct', () => {
    const prompts = DEFAULT_SCENE_EXEMPLAR_DEFINITIONS.map(d => d.generationPrompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });
});
