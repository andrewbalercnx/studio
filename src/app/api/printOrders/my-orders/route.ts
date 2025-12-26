import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';

/**
 * GET /api/printOrders/my-orders
 * Lists print orders for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const snapshot = await firestore
      .collection('printOrders')
      .where('ownerUserId', '==', user.uid)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const orders: PrintOrder[] = [];
    snapshot.forEach((doc) => {
      orders.push({
        id: doc.id,
        ...doc.data(),
      } as PrintOrder);
    });

    return NextResponse.json({ ok: true, orders });
  } catch (error: any) {
    console.error('[my-orders] Error listing orders:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
