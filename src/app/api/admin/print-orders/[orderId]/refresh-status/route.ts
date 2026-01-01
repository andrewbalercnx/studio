import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import type { PrintOrder } from '@/lib/types';
import { mixamClient } from '@/lib/mixam/client';
import { logMixamInteractions, toMixamInteractions } from '@/lib/mixam/interaction-logger';

/**
 * POST /api/admin/print-orders/[orderId]/refresh-status
 * Fetches the current status from Mixam and updates the order
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

    // Must have a Mixam order ID to refresh
    if (!order.mixamOrderId) {
      return NextResponse.json(
        { ok: false, error: 'Order has not been submitted to Mixam yet (no mixamOrderId)' },
        { status: 400 }
      );
    }

    // Try with mixamOrderId first, then fall back to mixamJobNumber
    const lookupId = order.mixamOrderId || order.mixamJobNumber;
    console.log(`[print-orders] Refreshing status from Mixam for order ${orderId}, Mixam ID: ${order.mixamOrderId}, Job Number: ${order.mixamJobNumber}`);

    // Fetch status from Mixam with logging
    let mixamStatus;
    let statusInteractions: any[] = [];
    try {
      const result = await mixamClient.getOrderStatusWithLogging(order.mixamOrderId);
      const { interactions, ...status } = result;
      mixamStatus = status;
      statusInteractions = interactions;
    } catch (error: any) {
      // Log interactions from failed attempt
      if (error.interactions) {
        await logMixamInteractions(firestore, orderId, toMixamInteractions(error.interactions, order.mixamOrderId));
      }

      // If order ID lookup fails, try with job number
      if (order.mixamJobNumber && order.mixamJobNumber !== order.mixamOrderId) {
        console.log(`[print-orders] Order ID lookup failed, trying job number: ${order.mixamJobNumber}`);
        const result = await mixamClient.getOrderStatusWithLogging(order.mixamJobNumber);
        const { interactions, ...status } = result;
        mixamStatus = status;
        statusInteractions = interactions;
      } else {
        throw error;
      }
    }

    // Log the API interactions
    await logMixamInteractions(firestore, orderId, toMixamInteractions(statusInteractions, order.mixamOrderId));

    console.log(`[print-orders] Mixam status response:`, JSON.stringify(mixamStatus, null, 2));

    // Update order with latest status
    const now = new Date();
    const previousStatus = order.mixamStatus;

    const updateData: Record<string, any> = {
      mixamStatus: mixamStatus.status,
      mixamStatusCheckedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add tracking URL if available
    if (mixamStatus.trackingUrl) {
      updateData.mixamTrackingUrl = mixamStatus.trackingUrl;
    }

    // Add estimated delivery if available
    if (mixamStatus.estimatedDelivery) {
      updateData.mixamEstimatedDelivery = mixamStatus.estimatedDelivery;
    }

    // If status changed, add to status history
    if (previousStatus !== mixamStatus.status) {
      updateData.statusHistory = FieldValue.arrayUnion({
        status: mixamStatus.status,
        timestamp: now,
        note: `Mixam status updated: ${previousStatus || 'unknown'} → ${mixamStatus.status}`,
        source: 'mixam',
      });

      // Map Mixam status to our fulfillment status
      const mixamToFulfillmentStatus: Record<string, string> = {
        'submitted': 'submitted',
        'confirmed': 'confirmed',
        'in_production': 'in_production',
        'printed': 'printed',
        'shipped': 'shipped',
        'delivered': 'delivered',
        'cancelled': 'cancelled',
      };

      if (mixamToFulfillmentStatus[mixamStatus.status]) {
        updateData.fulfillmentStatus = mixamToFulfillmentStatus[mixamStatus.status];
      }
    }

    // Add to process log (filter out undefined values for Firestore)
    const logData: Record<string, any> = {
      previousStatus: previousStatus || null,
      newStatus: mixamStatus.status,
    };
    if (mixamStatus.trackingUrl) {
      logData.trackingUrl = mixamStatus.trackingUrl;
    }
    if (mixamStatus.estimatedDelivery) {
      logData.estimatedDelivery = mixamStatus.estimatedDelivery;
    }

    updateData.processLog = FieldValue.arrayUnion({
      event: 'mixam_status_refreshed',
      timestamp: now,
      message: `Status refreshed from Mixam API`,
      data: logData,
      source: 'admin',
      userId: user.uid,
    });

    await orderDoc.ref.update(updateData);

    console.log(`[print-orders] Order ${orderId} status refreshed: ${mixamStatus.status}`);

    return NextResponse.json({
      ok: true,
      mixamStatus: mixamStatus.status,
      trackingUrl: mixamStatus.trackingUrl,
      estimatedDelivery: mixamStatus.estimatedDelivery,
      statusChanged: previousStatus !== mixamStatus.status,
    });
  } catch (error: any) {
    console.error('[print-orders] Error refreshing status:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
