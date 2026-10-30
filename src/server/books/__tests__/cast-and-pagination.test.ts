import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { displayText, extractCastTokens, isPlaceholderImageUrl, loadCast } from '../cast';
import { castSheetReferences, castSheetSource, rollupArt, statusFromArt } from '../jobs';
import { coerceSceneTag, degenerateReason, fitPageCount, rawPagesFrom, repairScene, type RawPage } from '../pagination';
import { storyFromDocument } from '../story-source';
import { completeStory } from './helpers';

describe('cast tokens', () => {
  it('finds every token format in order', () => {
    expect(extractCastTokens('[[cast:a]] met $$b$$ and $ccccccccccccccc$ and $$b$$')).toEqual(['a', 'b', 'ccccccccccccccc']);
  });
});

describe('loadCast', () => {
  it('is owner-scoped, drops placeholders and never uses the avatar', async () => {
    const db = new FakeFirestore().asFirestore();
    await db.collection('children').doc('c1').set({
      ownerParentUid: 'p1',
      displayName: 'Emma',
      photos: ['https://picsum.photos/seed/x/1', 'https://img/real.jpg'],
      canonicalImageUrl: 'https://picsum.photos/seed/portrait/1',
      avatarUrl: 'https://img/avatar.png',
    });
    await db.collection('characters').doc('mine').set({ ownerParentUid: 'p1', displayName: 'Granny', type: 'Family' });
    await db.collection('characters').doc('theirs').set({ ownerParentUid: 'p2', displayName: 'Other' });
    await db.collection('characters').doc('gone').set({ ownerParentUid: 'p1', displayName: 'Gone', deletedAt: 1 });
    await db.collection('characters').doc('x2').set({ ownerParentUid: 'p2', displayName: 'Granny Smith' });
    await db.collection('characters').doc('x3').set({ ownerParentUid: 'p1', displayName: 'Granny Smith' });

    const story = storyFromDocument('s', completeStory({ text: '[[cast:c1]] visits $$theirs$$, [[cast:gone]] and $$Granny Smith$$.', castIds: ['mine'] }));
    const cast = await loadCast(db, story);
    expect(cast.members.map((m) => [m.castId, m.role])).toEqual([
      ['c1', 'hero'],
      ['mine', 'supporting'],
      ['x3', 'supporting'],
    ]);
    const emma = cast.byId.get('c1')!;
    expect(emma.likeness).toEqual({ portrait: null, appearance: null, photos: ['https://img/real.jpg'] });
    expect(castSheetSource(emma)).toBe('photos');
    expect(castSheetReferences(emma)).toEqual(['https://img/real.jpg']);
    expect(castSheetSource(cast.byId.get('mine')!)).toBe('appearance');
    expect(displayText(story.text, cast)).toBe('Emma visits a friend, a friend and Granny Smith.');
    expect(isPlaceholderImageUrl('https://via.placeholder.com/1')).toBe(true);
  });
});

describe('pagination repair and fitting', () => {
  it('coerces scene tags from the words', () => {
    expect(coerceSceneTag('indoor-night', '')).toBe('indoor-night');
    expect(coerceSceneTag('night-time', 'bedroom by lamplight')).toBe('indoor-night');
    expect(coerceSceneTag(undefined, 'a forest')).toBe('outdoor-day');
  });

  it('repairs scenes and fills gaps from the previous page', () => {
    expect(repairScene({ locationDescription: 'a hall', actors: [] }, ['a'], 2)).toMatchObject({ locationKey: 'scene-2', actors: [{ id: 'a' }], sceneTag: 'indoor-day' });
    const pages = rawPagesFrom({
      pages: [
        { pageNumber: 1, text: 'One.', actors: ['a'], imageScene: { locationKey: 'park', locationDescription: 'a park' } },
        { pageNumber: 2, text: 'Two.', actors: ['$$b$$'] },
        { pageNumber: 3, text: '  ', actors: [] },
      ],
    });
    expect(pages).toHaveLength(2);
    expect(pages[1].scene).toMatchObject({ locationKey: 'park', actors: [{ id: 'b', action: 'in the scene' }] });
  });

  it('fits to exactly the length by merging and splitting', () => {
    const page = (text: string): RawPage => ({ text, actors: [], scene: null });
    const merged = fitPageCount([page('A.'), page('B.'), page('C long sentence here.'), page('D.')], 2)!;
    expect(merged.map((p) => p.text)).toEqual(['A. B.', 'C long sentence here. D.']);
    const split = fitPageCount([page('One. Two. Three. Four.')], 3)!;
    expect(split).toHaveLength(3);
    expect(split.map((p) => p.text).join(' ')).toBe('One. Two. Three. Four.');
    expect(fitPageCount([page('Hi')], 2)).toBeNull();
    expect(degenerateReason(merged, 3)).toBe('no text page has a usable scene');
  });
});

describe('art rollup', () => {
  const page = (n: number, artUrl: string | null, status: 'running' | 'failed' | 'succeeded' | null, kind: 'cover' | 'story' | 'title' = 'story') =>
    ({ id: String(n), pageNumber: n, kind, artUrl, artJob: status ? { jobId: `j${n}`, status } : null }) as never;

  it('is ready, partial, failed or still illustrating', () => {
    expect(statusFromArt(rollupArt([page(1, 'u', 'succeeded', 'cover'), page(2, 'u', 'succeeded'), page(3, null, null, 'title')]))).toBe('ready');
    expect(statusFromArt(rollupArt([page(1, 'u', 'succeeded'), page(2, null, 'failed')]))).toBe('partial');
    expect(statusFromArt(rollupArt([page(1, null, 'failed')]))).toBe('failed');
    expect(statusFromArt(rollupArt([page(1, null, 'running')]))).toBe('illustrating');
    expect(rollupArt([page(1, null, 'running')], new Map([[1, 'failed']])).art).toEqual({ total: 1, done: 0, failed: 1 });
  });
});
