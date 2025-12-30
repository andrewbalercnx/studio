import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import helpSampleData from '@/data/help-sample-data.json';

/**
 * Seeds sample data for Help Wizard demonstrations.
 * All document IDs start with 'help-' to allow public access via security rules.
 *
 * This creates demo documents in:
 * - children (help-child)
 * - characters (help-character)
 * - storySessions (help-session)
 * - stories (help-story)
 * - storyBooks (help-storybook)
 * - printStoryBooks (help-print-storybook)
 * - printOrders (help-print-order)
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    // Require admin or writer role
    if (!user.claims.isAdmin && !user.claims.isWriter) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin or writer access required' },
        { status: 403 }
      );
    }

    const db = getFirestore();
    const batch = db.batch();
    const timestamp = FieldValue.serverTimestamp();
    const seededDocs: string[] = [];

    // Seed children
    for (const child of helpSampleData.children) {
      const ref = db.collection('children').doc(child.id);
      batch.set(ref, {
        ...child,
        ownerParentUid: 'help-demo-parent', // Dummy parent UID
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`children/${child.id}`);
    }

    // Seed characters
    for (const character of helpSampleData.characters) {
      const ref = db.collection('characters').doc(character.id);
      batch.set(ref, {
        ...character,
        ownerParentUid: 'help-demo-parent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`characters/${character.id}`);
    }

    // Seed story sessions
    for (const session of helpSampleData.storySessions) {
      const ref = db.collection('storySessions').doc(session.id);
      batch.set(ref, {
        ...session,
        parentUid: 'help-demo-parent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`storySessions/${session.id}`);
    }

    // Seed stories
    for (const story of helpSampleData.stories) {
      const ref = db.collection('stories').doc(story.id);
      batch.set(ref, {
        ...story,
        parentUid: 'help-demo-parent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`stories/${story.id}`);
    }

    // Seed story books
    for (const book of helpSampleData.storyBooks) {
      const ref = db.collection('storyBooks').doc(book.id);
      batch.set(ref, {
        ...book,
        ownerUserId: 'help-demo-parent',
        parentUid: 'help-demo-parent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`storyBooks/${book.id}`);
    }

    // Seed print story books
    for (const printBook of helpSampleData.printStoryBooks) {
      const ref = db.collection('printStoryBooks').doc(printBook.id);
      batch.set(ref, {
        ...printBook,
        ownerUserId: 'help-demo-parent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`printStoryBooks/${printBook.id}`);
    }

    // Seed print orders
    for (const order of helpSampleData.printOrders) {
      const ref = db.collection('printOrders').doc(order.id);
      batch.set(ref, {
        ...order,
        parentUid: 'help-demo-parent',
        ownerUserId: 'help-demo-parent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      seededDocs.push(`printOrders/${order.id}`);
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      message: 'Help sample data seeded successfully',
      seededDocs,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/help-sample-data] Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}

/**
 * GET: Check which help sample documents exist
 */
export async function GET(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin && !user.claims.isWriter) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin or writer access required' },
        { status: 403 }
      );
    }

    const db = getFirestore();
    const existingDocs: string[] = [];
    const missingDocs: string[] = [];

    // Check each collection for help-* documents
    const collections = [
      { name: 'children', ids: helpSampleData.children.map(c => c.id) },
      { name: 'characters', ids: helpSampleData.characters.map(c => c.id) },
      { name: 'storySessions', ids: helpSampleData.storySessions.map(s => s.id) },
      { name: 'stories', ids: helpSampleData.stories.map(s => s.id) },
      { name: 'storyBooks', ids: helpSampleData.storyBooks.map(b => b.id) },
      { name: 'printStoryBooks', ids: helpSampleData.printStoryBooks.map(p => p.id) },
      { name: 'printOrders', ids: helpSampleData.printOrders.map(o => o.id) },
    ];

    for (const collection of collections) {
      for (const docId of collection.ids) {
        const doc = await db.collection(collection.name).doc(docId).get();
        const path = `${collection.name}/${docId}`;
        if (doc.exists) {
          existingDocs.push(path);
        } else {
          missingDocs.push(path);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      existingDocs,
      missingDocs,
      allSeeded: missingDocs.length === 0,
    });

  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/help-sample-data] GET Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
