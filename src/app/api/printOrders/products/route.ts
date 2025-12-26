import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { PrintProduct } from '@/lib/types';

/**
 * GET /api/printOrders/products
 * Lists available print products for ordering
 */
export async function GET(_request: NextRequest) {
  try {
    await initFirebaseAdminApp();
    const firestore = getFirestore();

    // Try simple query first (no orderBy to avoid index requirements)
    const snapshot = await firestore
      .collection('printProducts')
      .where('active', '==', true)
      .get();

    const products: PrintProduct[] = [];
    snapshot.forEach((doc) => {
      products.push({
        id: doc.id,
        ...doc.data(),
      } as PrintProduct);
    });

    // Sort by displayOrder in JS (avoids composite index requirement)
    products.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    if (products.length === 0) {
      console.warn('[print-products] No active print products found. Run POST /api/admin/print-products/seed to create products.');
    }

    return NextResponse.json({ ok: true, products });
  } catch (error: any) {
    console.error('[print-products] Error listing products:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
