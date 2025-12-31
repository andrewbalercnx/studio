import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { deleteStorageObject, getStoryBucket } from '@/firebase/admin/storage';

// The only valid parent email - all other user data can be cleaned
const VALID_PARENT_EMAIL = 'parent@rcnx.io';
// The help child ID that should be preserved
const HELP_CHILD_ID = 'help-child';

type CleanupCategory = {
  name: string;
  description: string;
  items: CleanupItem[];
  totalCount: number;
};

type CleanupItem = {
  id: string;
  collection: string;
  path: string;
  reason: string;
  details: Record<string, unknown>;
  canDelete: boolean;
};

type CleanupScanResult = {
  timestamp: string;
  categories: CleanupCategory[];
  summary: {
    totalItems: number;
    deletableItems: number;
    categoryCounts: Record<string, number>;
  };
};

type DeleteResult = {
  success: boolean;
  deleted: number;
  failed: number;
  errors: string[];
  deletedItems: string[];
};

// Helper to check if a document belongs to the valid parent
async function isValidParentDocument(
  firestore: FirebaseFirestore.Firestore,
  ownerUid: string
): Promise<boolean> {
  if (!ownerUid) return false;

  try {
    const userDoc = await firestore.collection('users').doc(ownerUid).get();
    if (!userDoc.exists) return false;
    const userData = userDoc.data();
    return userData?.email === VALID_PARENT_EMAIL;
  } catch {
    return false;
  }
}

// Scan for orphaned children (belonging to non-existent or non-valid parents)
async function scanOrphanedChildren(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const childrenSnap = await firestore.collection('children').get();

  for (const doc of childrenSnap.docs) {
    const data = doc.data();

    // Skip help-child
    if (doc.id === HELP_CHILD_ID || doc.id.startsWith('help-')) {
      continue;
    }

    // Check if owner is the valid parent
    if (data.ownerParentUid === validParentUid) {
      continue;
    }

    // Check if owner exists
    const ownerExists = data.ownerParentUid
      ? (await firestore.collection('users').doc(data.ownerParentUid).get()).exists
      : false;

    items.push({
      id: doc.id,
      collection: 'children',
      path: `children/${doc.id}`,
      reason: ownerExists
        ? 'Belongs to non-production parent'
        : 'Owner parent does not exist',
      details: {
        displayName: data.displayName,
        ownerParentUid: data.ownerParentUid,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
        deletedAt: data.deletedAt?.toDate?.()?.toISOString() || null,
      },
      canDelete: true,
    });
  }

  return items;
}

// Scan for orphaned characters
async function scanOrphanedCharacters(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const charactersSnap = await firestore.collection('characters').get();

  for (const doc of charactersSnap.docs) {
    const data = doc.data();

    // Skip help characters
    if (doc.id.startsWith('help-')) {
      continue;
    }

    // Check if owner is the valid parent
    if (data.ownerParentUid === validParentUid) {
      continue;
    }

    items.push({
      id: doc.id,
      collection: 'characters',
      path: `characters/${doc.id}`,
      reason: 'Belongs to non-production parent',
      details: {
        displayName: data.displayName,
        type: data.type,
        ownerParentUid: data.ownerParentUid,
        childId: data.childId,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
      },
      canDelete: true,
    });
  }

  return items;
}

// Scan for incomplete or orphaned story sessions
async function scanOrphanedSessions(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const sessionsSnap = await firestore.collection('storySessions').get();

  for (const doc of sessionsSnap.docs) {
    const data = doc.data();

    // Skip help sessions
    if (doc.id.startsWith('help-')) {
      continue;
    }

    // Check if owner is the valid parent
    if (data.parentUid === validParentUid) {
      // Still flag incomplete sessions even for valid parent
      if (data.status === 'in_progress') {
        const createdAt = data.createdAt?.toDate?.();
        const ageMs = createdAt ? Date.now() - createdAt.getTime() : 0;
        const ageHours = ageMs / (1000 * 60 * 60);

        // Flag sessions older than 24 hours that are still in progress
        if (ageHours > 24) {
          items.push({
            id: doc.id,
            collection: 'storySessions',
            path: `storySessions/${doc.id}`,
            reason: 'Incomplete session (in_progress for >24 hours)',
            details: {
              status: data.status,
              currentPhase: data.currentPhase,
              childId: data.childId,
              parentUid: data.parentUid,
              createdAt: createdAt?.toISOString() || 'unknown',
              ageHours: Math.round(ageHours),
            },
            canDelete: true,
          });
        }
      }
      continue;
    }

    items.push({
      id: doc.id,
      collection: 'storySessions',
      path: `storySessions/${doc.id}`,
      reason: 'Belongs to non-production parent',
      details: {
        status: data.status,
        currentPhase: data.currentPhase,
        childId: data.childId,
        parentUid: data.parentUid,
        storyTypeName: data.storyTypeName,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
      },
      canDelete: true,
    });
  }

  return items;
}

// Scan for orphaned stories
async function scanOrphanedStories(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const storiesSnap = await firestore.collection('stories').get();

  for (const doc of storiesSnap.docs) {
    const data = doc.data();

    // Skip help stories
    if (doc.id.startsWith('help-')) {
      continue;
    }

    // Check if owner is the valid parent
    if (data.parentUid === validParentUid) {
      continue;
    }

    items.push({
      id: doc.id,
      collection: 'stories',
      path: `stories/${doc.id}`,
      reason: 'Belongs to non-production parent',
      details: {
        title: data.metadata?.title || 'Untitled',
        childId: data.childId,
        parentUid: data.parentUid,
        storySessionId: data.storySessionId,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
        hasStorybooks: false, // Will be updated below
      },
      canDelete: true,
    });
  }

  return items;
}

// Scan for non-production users
async function scanNonProductionUsers(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const usersSnap = await firestore.collection('users').get();

  for (const doc of usersSnap.docs) {
    const data = doc.data();

    // Skip the valid parent
    if (data.email === VALID_PARENT_EMAIL) {
      continue;
    }

    // Skip admin users - they're needed for system access
    if (data.roles?.isAdmin) {
      continue;
    }

    items.push({
      id: doc.id,
      collection: 'users',
      path: `users/${doc.id}`,
      reason: 'Non-production user account',
      details: {
        email: data.email,
        roles: data.roles,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
      },
      canDelete: true,
    });
  }

  return items;
}

// Scan for orphaned print-related documents
async function scanOrphanedPrintDocs(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];

  // Scan printStoryBooks
  const printStoryBooksSnap = await firestore.collection('printStoryBooks').get();
  for (const doc of printStoryBooksSnap.docs) {
    const data = doc.data();

    if (doc.id.startsWith('help-')) continue;

    if (data.ownerUserId !== validParentUid) {
      items.push({
        id: doc.id,
        collection: 'printStoryBooks',
        path: `printStoryBooks/${doc.id}`,
        reason: 'Belongs to non-production parent',
        details: {
          title: data.title,
          ownerUserId: data.ownerUserId,
          storyId: data.storyId,
          pdfStatus: data.pdfStatus,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
        },
        canDelete: true,
      });
    }
  }

  // Scan printOrders
  const printOrdersSnap = await firestore.collection('printOrders').get();
  for (const doc of printOrdersSnap.docs) {
    const data = doc.data();

    if (doc.id.startsWith('help-')) continue;

    if (data.parentUid !== validParentUid) {
      items.push({
        id: doc.id,
        collection: 'printOrders',
        path: `printOrders/${doc.id}`,
        reason: 'Belongs to non-production parent',
        details: {
          parentUid: data.parentUid,
          storyId: data.storyId,
          fulfillmentStatus: data.fulfillmentStatus,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
        },
        canDelete: true,
      });
    }
  }

  return items;
}

// Scan for orphaned AI logs (optional - these are diagnostic)
async function scanOrphanedAILogs(
  firestore: FirebaseFirestore.Firestore,
  validParentUid: string | null,
  maxAge: number = 30 // days
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAge);

  // Scan aiFlowLogs older than maxAge days
  const aiLogsSnap = await firestore
    .collection('aiFlowLogs')
    .where('createdAt', '<', cutoffDate)
    .limit(500)
    .get();

  for (const doc of aiLogsSnap.docs) {
    const data = doc.data();

    items.push({
      id: doc.id,
      collection: 'aiFlowLogs',
      path: `aiFlowLogs/${doc.id}`,
      reason: `AI log older than ${maxAge} days`,
      details: {
        flowName: data.flowName,
        status: data.status,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
      },
      canDelete: true,
    });
  }

  // Scan aiRunTraces older than maxAge days
  const tracesSnap = await firestore
    .collection('aiRunTraces')
    .where('startedAt', '<', cutoffDate)
    .limit(500)
    .get();

  for (const doc of tracesSnap.docs) {
    const data = doc.data();

    items.push({
      id: doc.id,
      collection: 'aiRunTraces',
      path: `aiRunTraces/${doc.id}`,
      reason: `AI trace older than ${maxAge} days`,
      details: {
        sessionId: data.sessionId,
        status: data.status,
        totalCalls: data.summary?.totalCalls,
        startedAt: data.startedAt?.toDate?.()?.toISOString() || 'unknown',
      },
      canDelete: true,
    });
  }

  return items;
}

// Scan for deprecated/legacy collections
async function scanDeprecatedCollections(
  firestore: FirebaseFirestore.Firestore
): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];

  // Check for legacy 'storyBooks' collection (top-level, deprecated)
  try {
    const storyBooksSnap = await firestore.collection('storyBooks').limit(100).get();
    for (const doc of storyBooksSnap.docs) {
      const data = doc.data();
      items.push({
        id: doc.id,
        collection: 'storyBooks',
        path: `storyBooks/${doc.id}`,
        reason: 'Legacy storyBooks collection (deprecated)',
        details: {
          title: data.metadata?.title || 'Untitled',
          childId: data.childId,
          parentUid: data.parentUid,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || 'unknown',
        },
        canDelete: true,
      });
    }
  } catch {
    // Collection might not exist
  }

  // Check for legacy 'outputs' subcollections under stories
  const storiesSnap = await firestore.collection('stories').limit(100).get();
  for (const storyDoc of storiesSnap.docs) {
    try {
      const outputsSnap = await firestore
        .collection('stories')
        .doc(storyDoc.id)
        .collection('outputs')
        .limit(50)
        .get();

      for (const outputDoc of outputsSnap.docs) {
        items.push({
          id: outputDoc.id,
          collection: 'stories/*/outputs',
          path: `stories/${storyDoc.id}/outputs/${outputDoc.id}`,
          reason: 'Legacy outputs subcollection (deprecated)',
          details: {
            storyId: storyDoc.id,
          },
          canDelete: true,
        });
      }
    } catch {
      // Subcollection might not exist
    }
  }

  return items;
}

// Delete a document and its subcollections
async function deleteDocumentWithSubcollections(
  firestore: FirebaseFirestore.Firestore,
  path: string
): Promise<void> {
  const docRef = firestore.doc(path);

  // For stories, delete subcollections first
  if (path.startsWith('stories/') && !path.includes('/storybooks/') && !path.includes('/outputs/')) {
    const storyId = path.split('/')[1];

    // Delete storybooks subcollection and their pages
    const storybooksSnap = await firestore
      .collection('stories')
      .doc(storyId)
      .collection('storybooks')
      .get();

    for (const sbDoc of storybooksSnap.docs) {
      // Delete pages first
      const pagesSnap = await firestore
        .collection('stories')
        .doc(storyId)
        .collection('storybooks')
        .doc(sbDoc.id)
        .collection('pages')
        .get();

      for (const pageDoc of pagesSnap.docs) {
        await pageDoc.ref.delete();
      }
      await sbDoc.ref.delete();
    }

    // Delete shareTokens subcollection
    const tokensSnap = await firestore
      .collection('stories')
      .doc(storyId)
      .collection('shareTokens')
      .get();

    for (const tokenDoc of tokensSnap.docs) {
      await tokenDoc.ref.delete();
    }

    // Delete legacy outputs subcollection
    const outputsSnap = await firestore
      .collection('stories')
      .doc(storyId)
      .collection('outputs')
      .get();

    for (const outputDoc of outputsSnap.docs) {
      await outputDoc.ref.delete();
    }
  }

  // For storySessions, delete messages and events subcollections
  if (path.startsWith('storySessions/')) {
    const sessionId = path.split('/')[1];

    const messagesSnap = await firestore
      .collection('storySessions')
      .doc(sessionId)
      .collection('messages')
      .get();

    for (const msgDoc of messagesSnap.docs) {
      await msgDoc.ref.delete();
    }

    const eventsSnap = await firestore
      .collection('storySessions')
      .doc(sessionId)
      .collection('events')
      .get();

    for (const eventDoc of eventsSnap.docs) {
      await eventDoc.ref.delete();
    }
  }

  // For users, delete voices subcollection
  if (path.startsWith('users/')) {
    const userId = path.split('/')[1];

    const voicesSnap = await firestore
      .collection('users')
      .doc(userId)
      .collection('voices')
      .get();

    for (const voiceDoc of voicesSnap.docs) {
      await voiceDoc.ref.delete();
    }
  }

  // Delete the main document
  await docRef.delete();
}

// GET: Scan and return cleanup candidates
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);

    const firestore = getFirestore();

    // Find the valid parent UID
    const validParentSnap = await firestore
      .collection('users')
      .where('email', '==', VALID_PARENT_EMAIL)
      .limit(1)
      .get();

    const validParentUid = validParentSnap.empty ? null : validParentSnap.docs[0].id;

    // Scan all categories
    const [
      orphanedChildren,
      orphanedCharacters,
      orphanedSessions,
      orphanedStories,
      nonProductionUsers,
      orphanedPrintDocs,
      oldAILogs,
      deprecatedDocs,
    ] = await Promise.all([
      scanOrphanedChildren(firestore, validParentUid),
      scanOrphanedCharacters(firestore, validParentUid),
      scanOrphanedSessions(firestore, validParentUid),
      scanOrphanedStories(firestore, validParentUid),
      scanNonProductionUsers(firestore, validParentUid),
      scanOrphanedPrintDocs(firestore, validParentUid),
      scanOrphanedAILogs(firestore, validParentUid, 30),
      scanDeprecatedCollections(firestore),
    ]);

    const categories: CleanupCategory[] = [
      {
        name: 'Orphaned Children',
        description: 'Child profiles not belonging to the production parent account',
        items: orphanedChildren,
        totalCount: orphanedChildren.length,
      },
      {
        name: 'Orphaned Characters',
        description: 'Characters not belonging to the production parent account',
        items: orphanedCharacters,
        totalCount: orphanedCharacters.length,
      },
      {
        name: 'Orphaned/Incomplete Sessions',
        description: 'Story sessions that are incomplete or belong to non-production parents',
        items: orphanedSessions,
        totalCount: orphanedSessions.length,
      },
      {
        name: 'Orphaned Stories',
        description: 'Stories not belonging to the production parent account',
        items: orphanedStories,
        totalCount: orphanedStories.length,
      },
      {
        name: 'Non-Production Users',
        description: 'User accounts other than the production parent (excluding admins)',
        items: nonProductionUsers,
        totalCount: nonProductionUsers.length,
      },
      {
        name: 'Orphaned Print Documents',
        description: 'Print storybooks and orders not belonging to production parent',
        items: orphanedPrintDocs,
        totalCount: orphanedPrintDocs.length,
      },
      {
        name: 'Old AI Logs',
        description: 'AI flow logs and run traces older than 30 days',
        items: oldAILogs,
        totalCount: oldAILogs.length,
      },
      {
        name: 'Deprecated Collections',
        description: 'Documents in deprecated collections (legacy storyBooks, outputs)',
        items: deprecatedDocs,
        totalCount: deprecatedDocs.length,
      },
    ];

    const totalItems = categories.reduce((sum, cat) => sum + cat.totalCount, 0);
    const deletableItems = categories.reduce(
      (sum, cat) => sum + cat.items.filter(i => i.canDelete).length,
      0
    );

    const result: CleanupScanResult = {
      timestamp: new Date().toISOString(),
      categories,
      summary: {
        totalItems,
        deletableItems,
        categoryCounts: Object.fromEntries(
          categories.map(cat => [cat.name, cat.totalCount])
        ),
      },
    };

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[cleanup] Scan error:', error);
    return NextResponse.json({ error: error.message || 'Scan failed' }, { status: 500 });
  }
}

// POST: Delete specified items
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);

    const body = await request.json();
    const { items, category } = body as { items?: CleanupItem[]; category?: string };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items specified for deletion' }, { status: 400 });
    }

    const firestore = getFirestore();
    const result: DeleteResult = {
      success: true,
      deleted: 0,
      failed: 0,
      errors: [],
      deletedItems: [],
    };

    for (const item of items) {
      if (!item.canDelete) {
        result.failed++;
        result.errors.push(`Item ${item.path} is not deletable`);
        continue;
      }

      try {
        await deleteDocumentWithSubcollections(firestore, item.path);
        result.deleted++;
        result.deletedItems.push(item.path);
      } catch (error: any) {
        result.failed++;
        result.errors.push(`Failed to delete ${item.path}: ${error.message}`);
      }
    }

    result.success = result.failed === 0;

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[cleanup] Delete error:', error);
    return NextResponse.json({ error: error.message || 'Delete failed' }, { status: 500 });
  }
}

// DELETE: Delete all items in a category
export async function DELETE(request: Request) {
  try {
    await initFirebaseAdminApp();
    await requireAdminUser(request);

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (!category) {
      return NextResponse.json({ error: 'Category parameter required' }, { status: 400 });
    }

    const firestore = getFirestore();

    // Re-scan to get fresh items for the category
    const validParentSnap = await firestore
      .collection('users')
      .where('email', '==', VALID_PARENT_EMAIL)
      .limit(1)
      .get();

    const validParentUid = validParentSnap.empty ? null : validParentSnap.docs[0].id;

    let items: CleanupItem[] = [];

    switch (category) {
      case 'Orphaned Children':
        items = await scanOrphanedChildren(firestore, validParentUid);
        break;
      case 'Orphaned Characters':
        items = await scanOrphanedCharacters(firestore, validParentUid);
        break;
      case 'Orphaned/Incomplete Sessions':
        items = await scanOrphanedSessions(firestore, validParentUid);
        break;
      case 'Orphaned Stories':
        items = await scanOrphanedStories(firestore, validParentUid);
        break;
      case 'Non-Production Users':
        items = await scanNonProductionUsers(firestore, validParentUid);
        break;
      case 'Orphaned Print Documents':
        items = await scanOrphanedPrintDocs(firestore, validParentUid);
        break;
      case 'Old AI Logs':
        items = await scanOrphanedAILogs(firestore, validParentUid, 30);
        break;
      case 'Deprecated Collections':
        items = await scanDeprecatedCollections(firestore);
        break;
      default:
        return NextResponse.json({ error: `Unknown category: ${category}` }, { status: 400 });
    }

    const result: DeleteResult = {
      success: true,
      deleted: 0,
      failed: 0,
      errors: [],
      deletedItems: [],
    };

    for (const item of items) {
      if (!item.canDelete) {
        result.failed++;
        result.errors.push(`Item ${item.path} is not deletable`);
        continue;
      }

      try {
        await deleteDocumentWithSubcollections(firestore, item.path);
        result.deleted++;
        result.deletedItems.push(item.path);
      } catch (error: any) {
        result.failed++;
        result.errors.push(`Failed to delete ${item.path}: ${error.message}`);
      }
    }

    result.success = result.failed === 0;

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[cleanup] Category delete error:', error);
    return NextResponse.json({ error: error.message || 'Category delete failed' }, { status: 500 });
  }
}
