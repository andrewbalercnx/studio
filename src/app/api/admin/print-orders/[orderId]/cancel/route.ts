import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { mixamClient } from '@/lib/mixam/client';
import { notifyOrderCancelled } from '@/lib/email/notify-admins';
import { logMixamInteractions, toMixamInteractions } from '@/lib/mixam/interaction-logger';

/**
 * POST /api/admin/print-orders/[orderId]/cancel
 * Cancels a print order and updates Mixam if already submitted
 *
 * Request body:
 * - reason: string (optional) - Cancellation reason for records
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

    // Parse request body for cancellation reason
    let reason = '';
    try {
      const body = await request.json();
      reason = body.reason || '';
    } catch {
      // Body is optional
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

    // Check if order can be cancelled
    const cancellableStatuses = [
      'draft',
      'validating',
      'validation_failed',
      'ready_to_submit',
      'awaiting_approval',
      'approved',
      'submitted',
      'confirmed',
    ];

    if (!cancellableStatuses.includes(order.fulfillmentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Order cannot be cancelled from status: ${order.fulfillmentStatus}. Orders in production or later cannot be cancelled.`,
        },
        { status: 400 }
      );
    }

    // If order was already submitted to Mixam, try to cancel with them
    let mixamCancelResult = null;
    if (order.mixamOrderId) {
      try {
        console.log(`[print-orders] Cancelling order ${orderId} with Mixam (${order.mixamOrderId})`);
        const cancelResult = await mixamClient.cancelOrderWithLogging(order.mixamOrderId);
        const { interactions, ...result } = cancelResult;
        mixamCancelResult = result;

        // Log the API interactions
        await logMixamInteractions(firestore, orderId, toMixamInteractions(interactions, order.mixamOrderId));

        console.log(`[print-orders] Mixam cancel response:`, mixamCancelResult);
      } catch (mixamError: any) {
        console.error(`[print-orders] Mixam cancel failed:`, mixamError);

        // Log any interactions from the failed call
        if (mixamError.interactions) {
          await logMixamInteractions(firestore, orderId, toMixamInteractions(mixamError.interactions, order.mixamOrderId));
        }

        // If Mixam says order is already in production, don't allow cancellation
        if (mixamError.message?.includes('already in production')) {
          return NextResponse.json(
            {
              ok: false,
              error: 'Order cannot be cancelled - already in production with Mixam',
            },
            { status: 409 }
          );
        }

        // For other Mixam errors, log but continue with local cancellation
        // The order might not have been fully submitted to Mixam
        console.warn(`[print-orders] Proceeding with local cancellation despite Mixam error`);
      }
    }

    // Update order status in Firestore
    const now = new Date();
    const updateData: Record<string, any> = {
      fulfillmentStatus: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: user.uid,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'cancelled',
        timestamp: now,
        note: reason || `Cancelled by admin ${user.email || user.uid}`,
        source: 'admin',
        userId: user.uid,
      }),
    };

    if (reason) {
      updateData.cancellationReason = reason;
      updateData.fulfillmentNotes = `Cancelled: ${reason}`;
    }

    if (mixamCancelResult) {
      updateData.mixamStatus = 'CANCELED';
    }

    await orderDoc.ref.update(updateData);

    console.log(`[print-orders] Order ${orderId} cancelled by ${user.uid}${reason ? `: ${reason}` : ''}`);

    // Send email notification to notified admins
    try {
      await notifyOrderCancelled(firestore, order, reason);
    } catch (emailError: any) {
      console.error(`[print-orders] Failed to send cancel notification:`, emailError);
      // Don't fail the request due to email issues
    }

    return NextResponse.json({
      ok: true,
      orderId,
      mixamCancelled: !!mixamCancelResult,
    });
  } catch (error: any) {
    console.error('[print-orders] Error cancelling order:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
