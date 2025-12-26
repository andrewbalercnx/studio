import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { seedHardcoverProduct } from '@/lib/seed-print-products';

/**
 * Seeds the initial hardcover print product
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

    const result = await seedHardcoverProduct();

    if (!result.success) {
      return NextResponse.json(
        { ok: false, errorMessage: result.error || 'Failed to seed product' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      productId: result.productId,
      message: 'Hardcover product seeded successfully'
    });

  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, errorMessage: error.message },
        { status: error.status }
      );
    }

    console.error('[admin/print-products/seed] Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
