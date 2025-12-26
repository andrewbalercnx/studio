import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { auth } from 'firebase-admin';
import { getServerFirestore } from '@/lib/server-firestore';
import { migrateAllStoryTypes, summarizeMigrationResults } from '@/lib/migrations/migrate-story-types';

initFirebaseAdminApp();

export async function POST() {
  try {
    // Verify authentication
    const headerList = await headers();
    const authorization = headerList.get('Authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    const token = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(token);

    // Check if user is admin
    if (!decodedToken?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // Run migration
    const firestore = await getServerFirestore();
    const results = await migrateAllStoryTypes(firestore);
    const summary = summarizeMigrationResults(results);

    return NextResponse.json({
      success: summary.errors === 0,
      message: summary.errors === 0
        ? 'Migration completed successfully'
        : 'Migration completed with errors',
      summary,
      results,
    });
  } catch (error: any) {
    console.error('Story type migration error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Verify authentication
    const headerList = await headers();
    const authorization = headerList.get('Authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    const token = authorization.split('Bearer ')[1];
    const decodedToken = await auth().verifyIdToken(token);

    // Check if user is admin
    if (!decodedToken?.isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // Preview migration - show current state
    const firestore = await getServerFirestore();
    const storyTypesSnapshot = await firestore.collection('storyTypes').get();

    const storyTypes = storyTypesSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        hasPromptConfig: !!data.promptConfig,
        tags: data.tags || [],
      };
    });

    const needsMigration = storyTypes.filter(st => !st.hasPromptConfig);
    const alreadyMigrated = storyTypes.filter(st => st.hasPromptConfig);

    return NextResponse.json({
      total: storyTypes.length,
      needsMigration: needsMigration.length,
      alreadyMigrated: alreadyMigrated.length,
      storyTypes,
    });
  } catch (error: any) {
    console.error('Story type migration preview error:', error);
    return NextResponse.json(
      { error: error.message || 'Preview failed' },
      { status: 500 }
    );
  }
}
