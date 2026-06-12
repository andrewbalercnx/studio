import { describe, expect, it } from 'vitest';
import { coerceSceneTag, fillMissingScenes, repairImageScene } from '../image-scene-repair';

describe('coerceSceneTag', () => {
  it('passes valid tags through', () => {
    expect(coerceSceneTag('indoor-night', '')).toBe('indoor-night');
    expect(coerceSceneTag('outdoor-day', '')).toBe('outdoor-day');
  });

  it('repairs invalid tags using their own wording', () => {
    expect(coerceSceneTag('indoor-morning', '')).toBe('indoor-day');
    expect(coerceSceneTag('outside-at-night', '')).toBe('outdoor-night');
  });

  it('derives from scene description when tag is missing', () => {
    expect(coerceSceneTag(undefined, 'a cozy bedroom lit by lamplight at bedtime')).toBe('indoor-night');
    expect(coerceSceneTag(undefined, 'a sunny garden full of flowers')).toBe('outdoor-day');
  });

  it('defaults to outdoor-day with no signal', () => {
    expect(coerceSceneTag(undefined, 'two friends laughing')).toBe('outdoor-day');
  });
});

describe('repairImageScene', () => {
  const base = {
    locationKey: 'kitchen',
    locationDescription: 'a cozy farmhouse kitchen with a round wooden table',
    actors: [{ id: 'actor-1', action: 'reading a book' }],
    atmosphere: 'warm morning light',
    sceneTag: 'indoor-day',
  };

  it('keeps a fully valid scene intact', () => {
    expect(repairImageScene(base, ['actor-1'], 1)).toEqual(base);
  });

  it('returns undefined when there is no location description', () => {
    expect(repairImageScene({ ...base, locationDescription: '' }, [], 1)).toBeUndefined();
    expect(repairImageScene(undefined, [], 1)).toBeUndefined();
  });

  it('synthesises a locationKey when missing', () => {
    const scene = repairImageScene({ ...base, locationKey: undefined }, [], 4);
    expect(scene?.locationKey).toBe('scene-4');
  });

  it('defaults missing actors from the page actor ids', () => {
    const scene = repairImageScene({ ...base, actors: undefined }, ['a1', 'a2'], 1);
    expect(scene?.actors).toEqual([
      { id: 'a1', action: 'in the scene' },
      { id: 'a2', action: 'in the scene' },
    ]);
  });

  it('repairs an invalid sceneTag and defaults atmosphere from it', () => {
    const scene = repairImageScene(
      { locationKey: 'garden', locationDescription: 'a moonlit garden', sceneTag: 'nighttime-outside' },
      ['a1'],
      2,
    );
    expect(scene?.sceneTag).toBe('outdoor-night');
    expect(scene?.atmosphere).toContain('moonlight');
  });

  it('fills missing actor actions and drops malformed actor entries', () => {
    const scene = repairImageScene(
      { ...base, actors: [{ id: 'a1' }, { bogus: true }, { id: '  ' }] },
      [],
      1,
    );
    expect(scene?.actors).toEqual([{ id: 'a1', action: 'in the scene' }]);
  });
});

describe('fillMissingScenes', () => {
  const scene = (loc: string) => ({
    locationKey: loc,
    locationDescription: `the ${loc}`,
    actors: [{ id: 'a1', action: 'standing' }],
    atmosphere: 'warm',
    sceneTag: 'indoor-day' as const,
  });

  it('forward-fills a missing middle scene with the page own actors', () => {
    const pages = [
      { pageNumber: 1, actors: ['a1'], imageScene: scene('kitchen') },
      { pageNumber: 2, actors: ['a2'], imageScene: undefined },
      { pageNumber: 3, actors: ['a1'], imageScene: scene('garden') },
    ];
    const filled = fillMissingScenes(pages as any);
    expect(filled[1].imageScene?.locationKey).toBe('kitchen');
    expect(filled[1].imageScene?.actors).toEqual([{ id: 'a2', action: 'in the scene' }]);
    expect(filled[2].imageScene?.locationKey).toBe('garden');
  });

  it('backward-fills leading pages from the first scene', () => {
    const pages = [
      { pageNumber: 1, actors: [], imageScene: undefined },
      { pageNumber: 2, actors: ['a1'], imageScene: scene('forest') },
    ];
    const filled = fillMissingScenes(pages as any);
    expect(filled[0].imageScene?.locationKey).toBe('forest');
    expect(filled[0].imageScene?.actors).toEqual(scene('forest').actors);
  });

  it('leaves everything undefined when no page has a scene', () => {
    const pages = [
      { pageNumber: 1, actors: ['a1'], imageScene: undefined },
      { pageNumber: 2, actors: [], imageScene: undefined },
    ];
    const filled = fillMissingScenes(pages as any);
    expect(filled.every(p => p.imageScene === undefined)).toBe(true);
  });
});
