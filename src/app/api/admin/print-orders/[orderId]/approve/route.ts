import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { notifyOrderApproved } from '@/lib/email/notify-admins';

/**
 * POST /api/admin/print-orders/[orderId]/approve
 * Approves a print order for submission to Mixam
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

    // Verify order is in a state that can be approved
    // Accept both awaiting_approval (new) and ready_to_submit
    if (order.fulfillmentStatus !== 'awaiting_approval' && order.fulfillmentStatus !== 'ready_to_submit') {
      return NextResponse.json(
        { ok: false, error: `Order cannot be approved from status: ${order.fulfillmentStatus}` },
        { status: 400 }
      );
    }

    // Verify validation passed
    if (order.validationResult && !order.validationResult.valid) {
      return NextResponse.json(
        { ok: false, error: 'Order has validation errors and cannot be approved' },
        { status: 400 }
      );
    }

    // Update order status
    // Note: FieldValue.serverTimestamp() cannot be used inside arrayUnion, so use Date
    const now = new Date();
    await orderDoc.ref.update({
      fulfillmentStatus: 'approved',
      approvedBy: user.uid,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'approved',
        timestamp: now,
        note: `Approved by admin ${user.email || user.uid}`,
        source: 'admin',
      }),
    });

    console.log(`[print-orders] Order ${orderId} approved by ${user.uid}`);

    // Send email notification to notified admins
    try {
      const updatedOrder = { ...order, id: orderId } as PrintOrder;
      await notifyOrderApproved(firestore, updatedOrder);
    } catch (emailError: any) {
      console.warn('[print-orders] Failed to send approval notification:', emailError.message);
      // Don't fail the request due to email errors
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[print-orders] Error approving order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
