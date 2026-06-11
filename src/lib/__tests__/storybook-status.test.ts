import { describe, it, expect } from 'vitest';
import { deriveStorybookArtStatus, pageNeedsImage } from '../storybook-status';

const page = (
  overrides: Partial<{
    id: string;
    kind: string;
    imagePrompt: string;
    imageStatus: 'pending' | 'generating' | 'ready' | 'error';
  }> = {}
) =>
  ({
    id: overrides.id ?? 'p1',
    kind: overrides.kind ?? 'image',
    imagePrompt: 'imagePrompt' in overrides ? overrides.imagePrompt : 'a scene',
    imageStatus: overrides.imageStatus,
  }) as any;

describe('pageNeedsImage', () => {
  it('title pages, blank pages, and promptless pages never need art', () => {
    expect(pageNeedsImage(page({ kind: 'title_page' }))).toBe(false);
    expect(pageNeedsImage(page({ kind: 'blank' }))).toBe(false);
    expect(pageNeedsImage(page({ imagePrompt: undefined }))).toBe(false);
    expect(pageNeedsImage(page({ imagePrompt: '   ' }))).toBe(false);
    expect(pageNeedsImage(page({}))).toBe(true);
  });
});

describe('deriveStorybookArtStatus', () => {
  it('no pages -> none, not viewable, not orderable', () => {
    const s = deriveStorybookArtStatus([]);
    expect(s.completeness).toBe('none');
    expect(s.isViewable).toBe(false);
    expect(s.isOrderable).toBe(false);
  });

  it('any pending/generating illustratable page -> in_progress', () => {
    const s = deriveStorybookArtStatus([
      page({ id: 'a', imageStatus: 'ready' }),
      page({ id: 'b', imageStatus: 'generating' }),
      page({ id: 'c' }), // no status yet = pending
    ]);
    expect(s.completeness).toBe('in_progress');
    expect(s.pagesPending).toBe(2);
    expect(s.isViewable).toBe(true);
    expect(s.isOrderable).toBe(false);
  });

  it('mixed ready + failed (run finished) -> degraded: viewable AND orderable', () => {
    const s = deriveStorybookArtStatus([
      page({ id: 'a', imageStatus: 'ready' }),
      page({ id: 'b', imageStatus: 'error' }),
      page({ id: 'c', imageStatus: 'ready' }),
    ]);
    expect(s.completeness).toBe('degraded');
    expect(s.pagesReady).toBe(2);
    expect(s.pagesFailed).toBe(1);
    expect(s.failedPageIds).toEqual(['b']);
    expect(s.isViewable).toBe(true);
    expect(s.isOrderable).toBe(true);
  });

  it('all illustratable pages failed -> failed: viewable but NOT orderable', () => {
    const s = deriveStorybookArtStatus([
      page({ id: 'a', imageStatus: 'error' }),
      page({ id: 'b', imageStatus: 'error' }),
    ]);
    expect(s.completeness).toBe('failed');
    expect(s.isViewable).toBe(true);
    expect(s.isOrderable).toBe(false);
    expect(s.failedPageIds).toEqual(['a', 'b']);
  });

  it('all ready -> complete and orderable', () => {
    const s = deriveStorybookArtStatus([
      page({ id: 'a', imageStatus: 'ready' }),
      page({ id: 'b', imageStatus: 'ready' }),
    ]);
    expect(s.completeness).toBe('complete');
    expect(s.isOrderable).toBe(true);
  });

  it('book with only non-illustratable pages -> complete (nothing to paint)', () => {
    const s = deriveStorybookArtStatus([
      page({ id: 't', kind: 'title_page', imagePrompt: undefined }),
      page({ id: 'b', kind: 'blank' }),
    ]);
    expect(s.completeness).toBe('complete');
    expect(s.pagesTotal).toBe(0);
    expect(s.isViewable).toBe(true);
    expect(s.isOrderable).toBe(true);
  });

  it('title/blank failures never count against completeness', () => {
    const s = deriveStorybookArtStatus([
      page({ id: 't', kind: 'title_page', imagePrompt: undefined, imageStatus: 'error' }),
      page({ id: 'a', imageStatus: 'ready' }),
    ]);
    expect(s.completeness).toBe('complete');
    expect(s.pagesFailed).toBe(0);
  });
});
