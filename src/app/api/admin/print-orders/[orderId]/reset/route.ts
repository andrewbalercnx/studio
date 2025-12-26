import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';

/**
 * POST /api/admin/print-orders/[orderId]/reset
 * Resets a stuck order (e.g., in 'validating' state) back to 'approved' so it can be resubmitted
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const orderDoc = await firestore.collection('printOrders').doc(orderId).get();

    if (!orderDoc.exists) {
      return NextResponse.json(
        { ok: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    const order = { id: orderDoc.id, ...orderDoc.data() } as PrintOrder;

    // Only allow reset from certain stuck states
    const resettableStates = ['validating', 'validation_failed'];
    if (!resettableStates.includes(order.fulfillmentStatus)) {
      return NextResponse.json(
        { ok: false, error: `Cannot reset order from status: ${order.fulfillmentStatus}. Only orders in 'validating' or 'validation_failed' state can be reset.` },
        { status: 400 }
      );
    }

    // Reset to approved status
    // Note: FieldValue.serverTimestamp() cannot be used inside arrayUnion, so use Date
    const now = new Date();
    await orderDoc.ref.update({
      fulfillmentStatus: 'approved',
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'approved',
        timestamp: now,
        note: `Order reset to approved by admin ${user.email || user.uid} (was: ${order.fulfillmentStatus})`,
        source: 'admin',
      }),
    });

    console.log(`[print-orders] Order ${orderId} reset to approved by ${user.uid}`);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[print-orders] Error resetting order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
