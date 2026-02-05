import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { mixamClient } from '@/lib/mixam/client';
import { logMixamInteractions, toMixamInteractions } from '@/lib/mixam/interaction-logger';

/**
 * POST /api/admin/print-orders/[orderId]/confirm
 * Confirms a print order with Mixam using the Public API
 *
 * Orders must be in 'submitted' or 'on_hold' status to be confirmed.
 * This endpoint calls Mixam's POST /api/public/orders/{orderId}/confirm endpoint.
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

    const order = { id: orderId, ...orderDoc.data() } as PrintOrder;

    // Check if order can be confirmed
    const confirmableStatuses = ['submitted', 'on_hold'];

    if (!confirmableStatuses.includes(order.fulfillmentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Order cannot be confirmed from status: ${order.fulfillmentStatus}. Only submitted or on_hold orders can be confirmed.`,
        },
        { status: 400 }
      );
    }

    // Ensure order has a Mixam order ID
    if (!order.mixamOrderId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Order has no Mixam order ID. Submit the order to Mixam first.',
        },
        { status: 400 }
      );
    }

    // Confirm with Mixam
    console.log(`[print-orders] Confirming order ${orderId} with Mixam (${order.mixamOrderId})`);

    let confirmResult;
    try {
      const result = await mixamClient.confirmOrderWithLogging(order.mixamOrderId);
      const { interactions, ...mixamResult } = result;
      confirmResult = mixamResult;

      // Log the API interactions
      await logMixamInteractions(firestore, orderId, toMixamInteractions(interactions, order.mixamOrderId));

      console.log(`[print-orders] Mixam confirm response:`, confirmResult);
    } catch (mixamError: any) {
      console.error(`[print-orders] Mixam confirm failed:`, mixamError);

      // Log any interactions from the failed call
      if (mixamError.interactions) {
        await logMixamInteractions(firestore, orderId, toMixamInteractions(mixamError.interactions, order.mixamOrderId));
      }

      return NextResponse.json(
        {
          ok: false,
          error: `Failed to confirm order with Mixam: ${mixamError.message}`,
        },
        { status: 500 }
      );
    }

    // Update order status in Firestore
    const now = new Date();
    const updateData: Record<string, any> = {
      fulfillmentStatus: 'confirmed',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
      mixamStatus: confirmResult.status || 'confirmed',
      statusHistory: FieldValue.arrayUnion({
        status: 'confirmed',
        timestamp: now,
        note: `Confirmed with Mixam by admin ${user.email || user.uid}`,
        source: 'admin',
        userId: user.uid,
      }),
    };

    await orderDoc.ref.update(updateData);

    console.log(`[print-orders] Order ${orderId} confirmed by ${user.uid}`);

    return NextResponse.json({
      ok: true,
      orderId,
      mixamStatus: confirmResult.status,
    });
  } catch (error: any) {
    console.error('[print-orders] Error confirming order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
