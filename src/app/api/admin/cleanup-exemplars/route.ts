import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getStorage } from 'firebase-admin/storage';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

/**
 * DELETE /api/admin/cleanup-exemplars
 * Deletes all exemplar images from Firebase Storage.
 * Exemplars are stored at: stories/{storyId}/exemplars/
 */
export async function DELETE(request: Request) {
  try {
    // Verify admin access
    await requireAdminUser(request);

    await initFirebaseAdminApp();
    const storage = getStorage();
    const bucket = storage.bucket();

    // List all files in the stories/ prefix that contain /exemplars/
    const [files] = await bucket.getFiles({ prefix: 'stories/' });

    const exemplarFiles = files.filter(file => file.name.includes('/exemplars/'));

    console.log(`[cleanup-exemplars] Found ${exemplarFiles.length} exemplar file(s) to delete`);

    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const file of exemplarFiles) {
      try {
        await file.delete();
        deleted++;
        console.log(`[cleanup-exemplars] Deleted: ${file.name}`);
      } catch (err: any) {
        failed++;
        errors.push(`${file.name}: ${err.message}`);
        console.error(`[cleanup-exemplars] Failed to delete ${file.name}:`, err.message);
      }
    }

    return NextResponse.json({
      ok: true,
      deleted,
      failed,
      total: exemplarFiles.length,
      errors: errors.slice(0, 10), // Only return first 10 errors
    });
  } catch (error: any) {
    console.error('[cleanup-exemplars] Error:', error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to cleanup exemplars' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/cleanup-exemplars
 * Returns count of exemplar files in storage (for preview before deletion).
 */
export async function GET(request: Request) {
  try {
    // Verify admin access
    await requireAdminUser(request);

    await initFirebaseAdminApp();
    const storage = getStorage();
    const bucket = storage.bucket();

    // List all files in the stories/ prefix that contain /exemplars/
    const [files] = await bucket.getFiles({ prefix: 'stories/' });

    const exemplarFiles = files.filter(file => file.name.includes('/exemplars/'));

    // Group by story ID for summary
    const storyCounts: Record<string, number> = {};
    for (const file of exemplarFiles) {
      // Path format: stories/{storyId}/exemplars/{actorId}.png
      const match = file.name.match(/stories\/([^/]+)\/exemplars\//);
      if (match) {
        const storyId = match[1];
        storyCounts[storyId] = (storyCounts[storyId] || 0) + 1;
      }
    }

    return NextResponse.json({
      ok: true,
      totalFiles: exemplarFiles.length,
      storiesWithExemplars: Object.keys(storyCounts).length,
      storyCounts,
    });
  } catch (error: any) {
    console.error('[cleanup-exemplars] Error:', error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to count exemplars' },
      { status: 500 }
    );
  }
}
