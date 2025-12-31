import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { notifyOrderRejected } from '@/lib/email/notify-admins';

/**
 * POST /api/admin/print-orders/[orderId]/reject
 * Rejects a print order
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
        { ok: false, errorMessage: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { reason } = body;

    if (!reason || !reason.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Rejection reason is required' },
        { status: 400 }
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

    const order = orderDoc.data() as PrintOrder;

    // Verify order is in a state that can be rejected
    // Accept both awaiting_approval (new) and ready_to_submit
    if (order.fulfillmentStatus !== 'awaiting_approval' && order.fulfillmentStatus !== 'ready_to_submit') {
      return NextResponse.json(
        { ok: false, error: `Order cannot be rejected from status: ${order.fulfillmentStatus}` },
        { status: 400 }
      );
    }

    // Update order status
    // Use 'cancelled' for fulfillmentStatus (valid MixamOrderStatus)
    // and 'rejected' for approvalStatus
    // Note: FieldValue.serverTimestamp() cannot be used inside arrayUnion, so use Date
    const now = new Date();
    await orderDoc.ref.update({
      fulfillmentStatus: 'cancelled',
      approvalStatus: 'rejected',
      rejectedBy: user.uid,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectedReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'cancelled',
        timestamp: now,
        note: `Rejected by admin ${user.email || user.uid}: ${reason}`,
        source: 'admin',
      }),
    });

    console.log(`[print-orders] Order ${orderId} rejected by ${user.uid}`);

    // Send email notification to notified admins
    try {
      const updatedOrder = { ...order, id: orderId } as PrintOrder;
      await notifyOrderRejected(firestore, updatedOrder, reason);
    } catch (emailError: any) {
      console.warn('[print-orders] Failed to send rejection notification:', emailError.message);
      // Don't fail the request due to email errors
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[print-orders] Error rejecting order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
