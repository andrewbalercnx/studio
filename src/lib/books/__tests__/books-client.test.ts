import { describe, expect, it } from 'vitest';
import { bookProgress, isReadableStatus, pageArtState } from '../types';

describe('Book status helpers', () => {
  it('only names the server status: ready, partial and locked are readable', () => {
    expect(isReadableStatus('ready')).toBe(true);
    expect(isReadableStatus('partial')).toBe(true);
    expect(isReadableStatus('locked')).toBe(true);
    expect(isReadableStatus('illustrating')).toBe(false);
    expect(isReadableStatus('failed')).toBe(false);
    expect(isReadableStatus(undefined)).toBe(false);
  });

  it('reads a page picture state from artUrl and the latest art job', () => {
    expect(pageArtState({ artUrl: 'https://x', artJob: null })).toBe('done');
    expect(pageArtState({ artUrl: null, artJob: { jobId: 'j', status: 'failed' } })).toBe('failed');
    expect(pageArtState({ artUrl: null, artJob: { jobId: 'j', status: 'cancelled' } })).toBe('failed');
    expect(pageArtState({ artUrl: null, artJob: { jobId: 'j', status: 'running' } })).toBe('pending');
    expect(pageArtState({ artUrl: null, artJob: null })).toBe('pending');
  });
});

describe('bookProgress stages', () => {
  const page = (kind: 'cover' | 'story' | 'blank', art: boolean) => ({ kind, artUrl: art ? 'https://x' : null, artJob: null });
  const sheet = (ready: boolean) => ({ imageUrl: ready ? 'https://s' : null });
  const pages = [page('cover', false), page('story', false), page('story', false), page('blank', false)]; // 3 art pages

  it('is writing while the manuscript is still paginating (no page count yet)', () => {
    const p = bookProgress({ manuscriptStatus: 'paginating', pages: [], castSheets: [] });
    expect(p.stage).toBe('writing');
    expect(p.total).toBeNull();
  });

  it('is drawing the characters while cast sheets run and no page art is done', () => {
    const p = bookProgress({ manuscriptStatus: 'ready', pages, castSheets: [sheet(true), sheet(false), sheet(false)] });
    expect(p).toMatchObject({ stage: 'characters', done: 1, total: 3 });
    expect(p.percent).toBe(15); // 10 + round(15 * 1/3)
  });

  it('moves to the pages once every cast sheet is ready', () => {
    const p = bookProgress({ manuscriptStatus: 'ready', pages, castSheets: [sheet(true), sheet(true), sheet(true)] });
    expect(p).toMatchObject({ stage: 'pages', done: 0, total: 3 });
  });

  it('skips the characters stage when there are no cast sheets', () => {
    const p = bookProgress({ manuscriptStatus: 'ready', pages, castSheets: [] });
    expect(p.stage).toBe('pages');
  });

  it('counts finished page art and reaches 100% when every page is drawn', () => {
    const done = [page('cover', true), page('story', true), page('story', true), page('blank', false)];
    const p = bookProgress({ manuscriptStatus: 'ready', pages: done, castSheets: [sheet(true)] });
    expect(p).toMatchObject({ stage: 'pages', done: 3, total: 3, percent: 100 });
  });
});
