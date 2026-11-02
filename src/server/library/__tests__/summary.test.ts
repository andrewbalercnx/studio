import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../../testing/fake-firestore';
import { librarySummary } from '../summary';

describe('librarySummary', () => {
  it('counts Stories (not abandoned, not legacy) and Books per child and in total, for one family', async () => {
    const fake = new FakeFirestore();
    const story = (childId: string, status: string, schemaVersion: number | undefined = 2) => ({ ownerUid: 'p1', childId, status, schemaVersion });
    fake.store.set('stories/s1', story('c1', 'complete'));
    fake.store.set('stories/s2', story('c1', 'creating'));
    fake.store.set('stories/s3', story('c1', 'abandoned'));
    fake.store.set('stories/s4', story('c2', 'complete'));
    fake.store.set('stories/legacy', story('c2', 'complete', 1));
    fake.store.set('stories/other', { ...story('c9', 'complete'), ownerUid: 'p2' });
    fake.store.set('books/b1', { ownerUid: 'p1', childId: 'c1', status: 'ready' });
    fake.store.set('books/b2', { ownerUid: 'p1', childId: 'c1', status: 'illustrating' });
    fake.store.set('books/other', { ownerUid: 'p2', childId: 'c9', status: 'ready' });

    expect(await librarySummary(fake.asFirestore(), 'p1')).toEqual({
      totals: { stories: 3, books: 2 },
      byChild: { c1: { stories: 2, books: 2 }, c2: { stories: 1, books: 0 } },
    });
  });
});
