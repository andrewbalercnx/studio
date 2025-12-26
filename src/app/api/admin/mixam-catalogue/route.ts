import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { mixamClient } from '@/lib/mixam/client';

/**
 * GET /api/admin/mixam-catalogue
 * Fetches the Mixam product catalogue
 *
 * Query params:
 * - productId: (optional) Product ID to get metadata for
 * - subProductId: (optional) Sub-product ID (required if productId is set)
 * - type: 'catalogue' | 'metadata' | 'spec' (default: 'catalogue')
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'catalogue';
    const productId = searchParams.get('productId');
    const subProductId = searchParams.get('subProductId');

    console.log(`[mixam-catalogue] Request: type=${type}, productId=${productId}, subProductId=${subProductId}`);

    if (type === 'catalogue') {
      // Get full catalogue
      const catalogue = await mixamClient.getCatalogue();
      return NextResponse.json({ ok: true, data: catalogue });
    }

    if (type === 'metadata') {
      if (!productId || !subProductId) {
        return NextResponse.json(
          { ok: false, error: 'productId and subProductId are required for metadata' },
          { status: 400 }
        );
      }

      const metadata = await mixamClient.getProductMetadata(
        parseInt(productId, 10),
        parseInt(subProductId, 10)
      );
      return NextResponse.json({ ok: true, data: metadata });
    }

    if (type === 'spec') {
      if (!productId || !subProductId) {
        return NextResponse.json(
          { ok: false, error: 'productId and subProductId are required for spec' },
          { status: 400 }
        );
      }

      const spec = await mixamClient.getItemSpecification(
        parseInt(productId, 10),
        parseInt(subProductId, 10)
      );
      return NextResponse.json({ ok: true, data: spec });
    }

    return NextResponse.json(
      { ok: false, error: `Unknown type: ${type}` },
      { status: 400 }
    );

  } catch (error: any) {
    console.error('[mixam-catalogue] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
