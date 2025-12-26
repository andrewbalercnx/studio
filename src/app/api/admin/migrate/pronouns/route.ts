import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { auth } from 'firebase-admin';
import { migrateAllPronouns } from '@/lib/migration/migrate-children-characters';

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

    // Run pronouns migration
    const result = await migrateAllPronouns();

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? 'Pronouns migration completed successfully'
        : 'Pronouns migration completed with errors',
      childrenMigrated: result.childrenMigrated,
      childrenSkipped: result.childrenSkipped,
      charactersMigrated: result.charactersMigrated,
      charactersSkipped: result.charactersSkipped,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error('Pronouns migration error:', error);
    return NextResponse.json(
      { error: error.message || 'Pronouns migration failed' },
      { status: 500 }
    );
  }
}
