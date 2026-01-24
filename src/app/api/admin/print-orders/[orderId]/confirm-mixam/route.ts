import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';

/**
 * POST /api/admin/print-orders/[orderId]/confirm-mixam
 *
 * Marks a Mixam order as confirmed after the admin has manually confirmed it
 * on the Mixam website.
 *
 * NOTE: Automatic browser confirmation is not available in Firebase App Hosting.
 * The admin must:
 * 1. Open the Mixam order page and confirm manually
 * 2. Click "Mark as Confirmed" to update the order status here
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

    console.log(`[confirm-mixam] Marking order ${orderId} as confirmed (Mixam ID: ${order.mixamOrderId})`);

    // Update the order status to confirmed
    await firestore.collection('printOrders').doc(orderId).update({
      fulfillmentStatus: 'confirmed',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: user.email || user.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[confirm-mixam] Order ${orderId} marked as confirmed`);

    return NextResponse.json({
      ok: true,
      message: 'Order marked as confirmed',
      newStatus: 'confirmed',
    });
  } catch (error: any) {
    console.error('[confirm-mixam] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Unexpected error' },
      { status: 500 }
    );
  }
}
