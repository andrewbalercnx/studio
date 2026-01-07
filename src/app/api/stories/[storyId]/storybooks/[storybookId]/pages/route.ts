import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAuthToken } from '@/lib/auth-utils';
import {
  resolveEntitiesInText,
  replacePlaceholdersInText,
} from '@/lib/resolve-placeholders.server';

/**
 * GET /api/stories/[storyId]/storybooks/[storybookId]/pages
 * Returns pages for a specific storybook with placeholders resolved.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ storyId: string; storybookId: string }> }
) {
  try {
    const { storyId, storybookId } = await params;

    // Verify authentication
    const authResult = await verifyAuthToken(request);
    if (!authResult.valid || !authResult.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Verify ownership of the story
    const storyDoc = await firestore.collection('stories').doc(storyId).get();
    if (!storyDoc.exists || storyDoc.data()?.parentUid !== authResult.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch pages from subcollection
    const pagesSnapshot = await firestore
      .collection('stories')
      .doc(storyId)
      .collection('storybooks')
      .doc(storybookId)
      .collection('pages')
      .orderBy('pageNumber')
      .get();

    const rawPages = pagesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Collect all text that needs placeholder resolution
    const allText = rawPages.map((p: any) => p.bodyText || p.displayText || '').join(' ');
    const entityMap = await resolveEntitiesInText(allText);

    // Resolve placeholders in each page
    const pages = await Promise.all(
      rawPages.map(async (page: any) => {
        const bodyText = page.bodyText || '';
        const displayText = page.displayText || await replacePlaceholdersInText(bodyText, entityMap);
        return {
          ...page,
          displayText,
        };
      })
    );

    return NextResponse.json(pages);
  } catch (error: any) {
    console.error('[GET /api/stories/.../pages] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch pages' },
      { status: 500 }
    );
  }
}
