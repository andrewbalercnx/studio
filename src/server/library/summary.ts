/**
 * How many Stories and Books a family has, in total and per child, counted the
 * way the lists show them (server-first: clients render these numbers, they do
 * not count). Stories: target Stories that are not abandoned (as
 * GET /api/stories lists them). Books: every Book (as the book lists show them).
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { LibraryCounts, LibrarySummary } from '@/lib/library/types';
import { isTargetStory } from '../books/story-source';

export type { LibraryCounts, LibrarySummary };

function bump(byChild: Record<string, LibraryCounts>, childId: unknown, field: keyof LibraryCounts): void {
  if (typeof childId !== 'string' || !childId) return;
  (byChild[childId] ??= { stories: 0, books: 0 })[field] += 1;
}

export async function librarySummary(db: Firestore, ownerUid: string): Promise<LibrarySummary> {
  const [storySnap, bookSnap] = await Promise.all([
    db.collection('stories').where('ownerUid', '==', ownerUid).get(),
    db.collection('books').where('ownerUid', '==', ownerUid).get(),
  ]);
  const byChild: Record<string, LibraryCounts> = {};
  const totals: LibraryCounts = { stories: 0, books: 0 };
  for (const doc of storySnap.docs) {
    const data = doc.data();
    if (!isTargetStory(data) || data.status === 'abandoned') continue;
    totals.stories += 1;
    bump(byChild, data.childId, 'stories');
  }
  for (const doc of bookSnap.docs) {
    const data = doc.data();
    totals.books += 1;
    bump(byChild, data.childId, 'books');
  }
  return { totals, byChild };
}
