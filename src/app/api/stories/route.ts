import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';
import {
  resolveEntitiesInText,
  replacePlaceholdersInText,
} from '@/lib/resolve-placeholders.server';

/**
 * GET /api/stories?childId=xxx
 * Returns stories for a specific child belonging to the authenticated parent.
 *
 * Each story includes:
 * - All story fields
 * - titleResolved: Title with placeholders replaced
 * - synopsisResolved: Synopsis with placeholders resolved (for list preview)
 * - actors: Array of actor profiles with displayName and avatarUrl
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const childId = searchParams.get('childId');

    if (!childId) {
      return NextResponse.json({ error: 'childId is required' }, { status: 400 });
    }

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Verify the child belongs to this parent
    const childDoc = await firestore.collection('children').doc(childId).get();
    if (!childDoc.exists || childDoc.data()?.ownerParentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch stories for this child
    const storiesSnapshot = await firestore
      .collection('stories')
      .where('childId', '==', childId)
      .get();

    // Process stories: filter, sort, and resolve placeholders
    const storiesRaw = storiesSnapshot.docs
      .filter(doc => !doc.data().deletedAt) // Exclude soft-deleted
      .map(doc => ({ id: doc.id, ...doc.data() }))
      // Sort by createdAt descending (most recent first)
      .sort((a, b) => {
        const aTime = (a as any).createdAt?.seconds || (a as any).createdAt?._seconds || 0;
        const bTime = (b as any).createdAt?.seconds || (b as any).createdAt?._seconds || 0;
        return bTime - aTime;
      });

    // Collect all text that needs placeholder resolution across all stories
    const allTexts = storiesRaw.map((s: any) =>
      `${s.metadata?.title || ''} ${s.synopsis || ''}`
    ).join(' ');
    const entityMap = await resolveEntitiesInText(allTexts);

    // Process each story with resolved placeholders and actor profiles
    const stories = await Promise.all(
      storiesRaw.map(async (story: any) => {
        const title = story.metadata?.title || '';
        const synopsis = story.synopsis || '';

        const titleResolved = await replacePlaceholdersInText(title, entityMap);
        const synopsisResolved = await replacePlaceholdersInText(synopsis, entityMap);

        // Build actors array from story.actors (which contains IDs)
        const actorIds: string[] = story.actors || [];
        const actors: Array<{ id: string; displayName: string; avatarUrl?: string; type: 'child' | 'character' }> = [];

        for (const actorId of actorIds) {
          if (!actorId) continue;
          const entity = entityMap.get(actorId);
          if (entity) {
            const doc = entity.document;
            const isCharacter = 'role' in doc;
            actors.push({
              id: actorId,
              displayName: entity.displayName,
              avatarUrl: doc.avatarUrl,
              type: isCharacter ? 'character' : 'child',
            });
          }
        }

        return {
          ...story,
          titleResolved,
          synopsisResolved,
          actors,
        };
      })
    );

    return NextResponse.json(stories);
  } catch (error: any) {
    console.error('[GET /api/stories] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stories' },
      { status: 500 }
    );
  }
}
