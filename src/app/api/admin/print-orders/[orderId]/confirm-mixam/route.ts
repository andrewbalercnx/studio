import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { confirmMixamOrder } from '@/lib/mixam/browser-confirm';

/**
 * POST /api/admin/print-orders/[orderId]/confirm-mixam
 *
 * Confirms a Mixam order using Steel cloud browser automation.
 *
 * The order must be in 'submitted' or 'on_hold' status.
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

    const order = { id: orderDoc.id, ...orderDoc.data() } as PrintOrder;

    // Verify order has been submitted to Mixam
    if (!order.mixamOrderId) {
      return NextResponse.json(
        { ok: false, error: 'Order has not been submitted to Mixam yet' },
        { status: 400 }
      );
    }

    // Verify order is in submitted/pending or on_hold status
    const allowedStatuses = ['submitted', 'on_hold'];
    if (!allowedStatuses.includes(order.fulfillmentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Order must be in submitted (pending) or on_hold status to confirm. Current status: ${order.fulfillmentStatus}`,
        },
        { status: 400 }
      );
    }

    console.log(`[confirm-mixam] Starting browser confirmation for order ${orderId}, Mixam ID: ${order.mixamOrderId}`);

    // Attempt to confirm the order using browser automation
    const result = await confirmMixamOrder(order.mixamOrderId);

    // Log the attempt
    await firestore.collection('printOrders').doc(orderId).update({
      'mixamConfirmAttempt': {
        timestamp: FieldValue.serverTimestamp(),
        success: result.success,
        message: result.message,
        error: result.error || null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (result.success) {
      console.log(`[confirm-mixam] Successfully confirmed order ${orderId}`);

      // Update the order status to confirmed
      await firestore.collection('printOrders').doc(orderId).update({
        fulfillmentStatus: 'confirmed',
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedBy: user.email || user.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        ok: true,
        message: result.message,
        newStatus: 'confirmed',
      });
    } else {
      console.error(`[confirm-mixam] Failed to confirm order ${orderId}: ${result.error || result.message}`);

      return NextResponse.json({
        ok: false,
        error: result.message,
        details: result.error,
        screenshots: result.screenshots,
      });
    }
  } catch (error: any) {
    console.error('[confirm-mixam] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
