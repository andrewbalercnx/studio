import { describe, expect, it } from 'vitest';
import { currentTraceContext, traceContextForJob, withTraceContext } from '../trace-context';

describe('trace context', () => {
  it('names the Book, Manuscript or Story a job targets, and ids in its input', () => {
    expect(traceContextForJob({ jobId: 'j1', kind: 'book.pageArt', target: { collection: 'books', id: 'bk_1' } })).toEqual({
      jobId: 'j1',
      jobKind: 'book.pageArt',
      bookId: 'bk_1',
    });
    expect(
      traceContextForJob({ jobId: 'j2', kind: 'manuscript.paginate', target: { collection: 'manuscripts', id: 'ms_1' }, input: { bookId: 'bk_2', storyId: 7 } })
    ).toEqual({ jobId: 'j2', jobKind: 'manuscript.paginate', manuscriptId: 'ms_1', bookId: 'bk_2' });
  });

  it('nests: inner context adds to the outer one, and is gone outside', async () => {
    await withTraceContext({ jobId: 'j1', bookId: 'bk_1' }, async () => {
      await withTraceContext({ storyId: 'st_1' }, async () => {
        await Promise.resolve();
        expect(currentTraceContext()).toEqual({ jobId: 'j1', bookId: 'bk_1', storyId: 'st_1' });
      });
      expect(currentTraceContext()).toEqual({ jobId: 'j1', bookId: 'bk_1' });
    });
    expect(currentTraceContext()).toEqual({});
  });
});
