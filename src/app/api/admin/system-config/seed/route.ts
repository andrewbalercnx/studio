import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { seedDiagnosticsConfig } from '@/lib/seed-system-config';

/**
 * Seeds the system configuration documents
 * Admin-only endpoint
 */
export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const result = await seedDiagnosticsConfig();

    if (!result.success) {
      return NextResponse.json(
        { ok: false, errorMessage: result.error || 'Failed to seed system config' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.error || 'System config seeded successfully'
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/system-config/seed] Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}