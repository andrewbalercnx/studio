import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';
import {
  resolveEntitiesInText,
  replacePlaceholdersInText,
} from '@/lib/resolve-placeholders.server';
import { z } from 'zod';
import { creationModeIdSchema } from '@/server/data';
import { createStory, getCreationServiceDeps } from '@/server/creation';
import { ok, withRoute } from '@/server/http';

const CreateStoryBody = z.object({
  childId: z.string().min(1).max(128),
  modeId: creationModeIdSchema,
  castIds: z.array(z.string().min(1).max(128)).max(12).optional(),
  /** adventure only: skip the story-type question. */
  storyTypeId: z.string().min(1).max(128).optional(),
  // Required: a double tap must not start two Stories.
  idempotencyKey: z.string().min(8).max(128),
});

/**
 * POST /api/stories — start creating a Story (slice 5.3, creation.md). Checks
 * the child is the caller's (persona scope applies), the mode is live (and
 * enabled for kids under a child persona), and the story allowance is
 * available (402 ENTITLEMENT_LIMIT; consumed later by `story.finish`). Records
 * the mode's first turn and returns it. A repeat with the same
 * `idempotencyKey` returns the same Story and turn (200 instead of 201).
 */
export const POST = withRoute({ auth: 'user', body: CreateStoryBody, name: 'stories.create' }, async ({ user, body }) => {
  const result = await createStory(await getCreationServiceDeps(), user, body);
  return ok(result, result.created ? 201 : 200);
});

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
    const entityMap = await resolveEntitiesInText(allTexts, authResult.uid);

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
