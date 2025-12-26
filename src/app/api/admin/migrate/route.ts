import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { auth } from 'firebase-admin';
import { migrateAll } from '@/lib/migration/migrate-children-characters';

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
    const result = await migrateAll();

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? 'Migration completed successfully'
        : 'Migration completed with errors',
      childrenMigrated: result.childrenMigrated,
      charactersMigrated: result.charactersMigrated,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error.message || 'Migration failed' },
      { status: 500 }
    );
  }
}
