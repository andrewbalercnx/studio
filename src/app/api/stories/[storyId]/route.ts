import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';
import {
  resolveEntitiesInText,
  replacePlaceholdersInText,
} from '@/lib/resolve-placeholders.server';

/**
 * GET /api/stories/[storyId]
 * Returns a specific story with placeholders resolved.
 *
 * Response includes:
 * - All story fields
 * - titleResolved: Title with placeholders replaced with actual names
 * - synopsisResolved: Synopsis with placeholders resolved
 * - storyTextResolved: Full story text with placeholders resolved
 * - actors: Array of actor profiles (children and characters) with avatars
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ storyId: string }> }
) {
  try {
    const { storyId } = await params;

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Fetch the story
    const storyDoc = await firestore.collection('stories').doc(storyId).get();

    if (!storyDoc.exists) {
      return NextResponse.json({ error: 'Story not found' }, { status: 404 });
    }

    const storyData = storyDoc.data();

    // Verify ownership (parent owns the story)
    if (storyData?.parentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Collect all text that needs placeholder resolution
    const title = storyData.metadata?.title || '';
    const synopsis = storyData.synopsis || '';
    const storyText = storyData.storyText || '';
    const allText = `${title} ${synopsis} ${storyText}`;

    // Resolve entities from all text
    const entityMap = await resolveEntitiesInText(allText);

    // Resolve placeholders in each field
    const titleResolved = await replacePlaceholdersInText(title, entityMap);
    const synopsisResolved = await replacePlaceholdersInText(synopsis, entityMap);
    const storyTextResolved = await replacePlaceholdersInText(storyText, entityMap);

    // Build actors array from entity map
    const actors: Array<{
      id: string;
      displayName: string;
      avatarUrl?: string;
      type: 'child' | 'character';
    }> = [];

    for (const [id, entity] of entityMap.entries()) {
      const doc = entity.document;
      // Check if it's a character (has 'role' field) or a child
      const isCharacter = 'role' in doc;
      actors.push({
        id,
        displayName: entity.displayName,
        avatarUrl: doc.avatarUrl,
        type: isCharacter ? 'character' : 'child',
      });
    }

    return NextResponse.json({
      id: storyDoc.id,
      ...storyData,
      // Add resolved text fields
      titleResolved,
      synopsisResolved,
      storyTextResolved,
      // Add actors array
      actors,
    });
  } catch (error: any) {
    console.error('[GET /api/stories/[storyId]] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch story' },
      { status: 500 }
    );
  }
}
