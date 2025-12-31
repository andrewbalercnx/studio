import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { PrintOrder } from '@/lib/types';

/**
 * Mixam Webhook Handler
 * Receives status updates from Mixam for print orders
 *
 * Based on Mixam Webhooks API documentation:
 * When order status changes, Mixam sends a POST to the statusCallbackUrl
 * specified when creating the order.
 */

// Mixam webhook payload structure (from their API docs)
type MixamWebhookPayload = {
  orderId: string; // Mixam's order ID
  status: string; // e.g., "PENDING", "INPRODUCTION", "DISPATCHED", "ONHOLD"
  statusReason?: string; // Reason for current status (e.g., why on hold)
  metadata: {
    externalOrderId: string; // Our order ID
    statusCallbackUrl: string;
  };
  items: Array<{
    itemId: string;
    metadata: {
      externalItemId: string;
    };
    errors?: Array<{
      filename: string;
      page: number;
      message: string;
    }>;
    hasErrors: boolean;
  }>;
  hasErrors: boolean;
  artworkComplete: boolean;
  shipments?: Array<{
    itemsInShipment: Record<string, number>;
    trackingUrl?: string;
    consignmentNumber?: string;
    courier?: string;
    parcelNumbers?: string[];
    date?: {
      date: string;
      timestamp: number;
    };
  }>;
};

// Map Mixam status strings to our internal status
type MixamOrderStatus =
  | 'submitted'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'on_hold'
  | 'validation_failed';

function mapMixamStatusToInternal(status: string, hasErrors: boolean): MixamOrderStatus {
  // Normalize status to uppercase for comparison
  const normalizedStatus = status.toUpperCase();

  // If there are errors, it's validation failed
  if (hasErrors) {
    return 'on_hold';
  }

  switch (normalizedStatus) {
    case 'PENDING':
    case 'RECEIVED':
      return 'submitted';
    case 'CONFIRMED':
    case 'ACCEPTED':
      return 'confirmed';
    case 'INPRODUCTION':
    case 'IN_PRODUCTION':
    case 'PRINTING':
      return 'in_production';
    case 'DISPATCHED':
    case 'SHIPPED':
      return 'shipped';
    case 'DELIVERED':
      return 'delivered';
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled';
    case 'ONHOLD':
    case 'ON_HOLD':
      return 'on_hold';
    default:
      console.log(`[Mixam Webhook] Unknown status: ${status}, defaulting to submitted`);
      return 'submitted';
  }
}

/**
 * Verifies webhook signature from Mixam
 * Uses HMAC-SHA256 with shared secret
 * Note: Mixam may not require signature verification - check their docs
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  // If no signature provided and we have a placeholder secret, skip verification
  // This allows testing while we wait for Mixam to provide the real secret
  if (!signature && secret === 'your_webhook_secret_from_mixam') {
    console.warn('[Mixam Webhook] Skipping signature verification (placeholder secret)');
    return true;
  }

  // If no signature header, skip verification (Mixam may not send one)
  if (!signature) {
    console.warn('[Mixam Webhook] No signature provided, allowing request');
    return true;
  }

  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();

    // 1. Read raw body for signature verification
    const rawBody = await request.text();

    console.log('[Mixam Webhook] Received webhook payload:', rawBody.substring(0, 500));

    // 2. Verify webhook signature (if configured)
    const signature = request.headers.get('X-Mixam-Signature');
    const webhookSecret = process.env.MIXAM_WEBHOOK_SECRET;

    if (webhookSecret && !verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('[Mixam Webhook] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // 3. Parse webhook payload
    const webhook: MixamWebhookPayload = JSON.parse(rawBody);

    console.log(`[Mixam Webhook] Order ${webhook.orderId} status: ${webhook.status}`);
    console.log(`[Mixam Webhook] External Order ID: ${webhook.metadata?.externalOrderId}`);
    console.log(`[Mixam Webhook] Has errors: ${webhook.hasErrors}, Artwork complete: ${webhook.artworkComplete}`);

    // 4. Find the print order by our external order ID
    const firestore = getFirestore();
    const ourOrderId = webhook.metadata?.externalOrderId;

    if (!ourOrderId) {
      console.error('[Mixam Webhook] No externalOrderId in webhook metadata');
      return NextResponse.json({ received: true, error: 'Missing externalOrderId' });
    }

    console.log(`[Mixam Webhook] Looking up order: ${ourOrderId}`);
    console.log(`[Mixam Webhook] Firestore project: ${(firestore as any)._settings?.projectId || 'unknown'}`);

    const orderDoc = await firestore.collection('printOrders').doc(ourOrderId).get();
    console.log(`[Mixam Webhook] Order exists: ${orderDoc.exists}`);

    if (!orderDoc.exists) {
      // Try listing a few orders to verify collection access
      try {
        const testQuery = await firestore.collection('printOrders').limit(1).get();
        console.log(`[Mixam Webhook] Test query found ${testQuery.size} orders`);
        if (testQuery.size > 0) {
          console.log(`[Mixam Webhook] Sample order ID: ${testQuery.docs[0].id}`);
        }
      } catch (e: any) {
        console.error(`[Mixam Webhook] Test query failed: ${e.message}`);
      }

      console.error(`[Mixam Webhook] Order not found: ${ourOrderId}`);
      // Return 200 anyway to prevent Mixam retries
      return NextResponse.json({ received: true, warning: 'Order not found' });
    }

    const order = { id: orderDoc.id, ...orderDoc.data() } as PrintOrder;

    // 5. Map status
    const newStatus = mapMixamStatusToInternal(webhook.status, webhook.hasErrors);

    // 6. Build update data
    const updateData: Record<string, any> = {
      mixamStatus: webhook.status,
      mixamArtworkComplete: webhook.artworkComplete,
      mixamHasErrors: webhook.hasErrors,
      fulfillmentUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Store full webhook payload for debugging
      lastWebhookPayload: webhook,
      lastWebhookAt: FieldValue.serverTimestamp(),
    };

    // Update fulfillment status if it changed
    if (order.fulfillmentStatus !== newStatus) {
      updateData.fulfillmentStatus = newStatus;
    }

    // Store status reason if provided
    if (webhook.statusReason) {
      updateData.mixamStatusReason = webhook.statusReason;
      updateData.fulfillmentNotes = webhook.statusReason;
    }

    // Add status to history
    const now = new Date();
    updateData.statusHistory = FieldValue.arrayUnion({
      status: newStatus,
      timestamp: now,
      note: webhook.statusReason || `Mixam status: ${webhook.status}`,
      source: 'webhook',
      mixamStatus: webhook.status,
    });

    // Extract and store artwork errors if present
    if (webhook.hasErrors && webhook.items) {
      const allErrors: Array<{ itemId: string; filename: string; page: number; message: string }> = [];

      for (const item of webhook.items) {
        if (item.hasErrors && item.errors) {
          for (const error of item.errors) {
            allErrors.push({
              itemId: item.itemId,
              filename: error.filename,
              page: error.page,
              message: error.message,
            });
          }
        }
      }

      if (allErrors.length > 0) {
        updateData.mixamArtworkErrors = allErrors;
        updateData.mixamValidation = {
          valid: false,
          errors: allErrors.map(e => `Page ${e.page}: ${e.message}`),
          warnings: [],
          checkedAt: Date.now(),
        };

        // Set fulfillment notes with error summary
        const errorSummary = allErrors.map(e => e.message).join('; ');
        updateData.fulfillmentNotes = `Artwork errors: ${errorSummary}`;
      }
    }

    // Extract shipment information
    if (webhook.shipments && webhook.shipments.length > 0) {
      const latestShipment = webhook.shipments[webhook.shipments.length - 1];

      if (latestShipment.trackingUrl) {
        updateData.mixamTrackingUrl = latestShipment.trackingUrl;
      }
      if (latestShipment.consignmentNumber) {
        updateData.mixamTrackingNumber = latestShipment.consignmentNumber;
      }
      if (latestShipment.courier) {
        updateData.mixamCarrier = latestShipment.courier;
      }
      if (latestShipment.parcelNumbers && latestShipment.parcelNumbers.length > 0) {
        updateData.mixamParcelNumbers = latestShipment.parcelNumbers;
      }
      if (latestShipment.date) {
        updateData.mixamShipmentDate = latestShipment.date.date;
      }

      // Store all shipments for reference
      updateData.mixamShipments = webhook.shipments;
    }

    // 7. Update order in Firestore
    await orderDoc.ref.update(updateData);

    // 8. Log event in session history if available
    if (order.storyId) {
      try {
        const storyDoc = await firestore.collection('stories').doc(order.storyId).get();
        const storyData = storyDoc.data();

        if (storyData?.storySessionId) {
          await firestore
            .collection('storySessions')
            .doc(storyData.storySessionId)
            .collection('events')
            .add({
              event: 'print_order.webhook_received',
              status: 'completed',
              source: 'mixam_webhook',
              attributes: {
                orderId: order.id,
                mixamOrderId: webhook.orderId,
                newStatus,
                mixamStatus: webhook.status,
                hasErrors: webhook.hasErrors,
              },
              createdAt: FieldValue.serverTimestamp(),
            });
        }
      } catch (error) {
        console.warn('[Mixam Webhook] Failed to log session event', error);
      }
    }

    console.log(`[Mixam Webhook] Successfully processed webhook for order ${ourOrderId}`);
    console.log(`[Mixam Webhook] Status: ${newStatus}, Has errors: ${webhook.hasErrors}`);

    return NextResponse.json({
      received: true,
      orderId: ourOrderId,
      status: newStatus,
    });

  } catch (error: any) {
    console.error('[Mixam Webhook] Error processing webhook:', error);

    // Return 200 to prevent Mixam retries for our internal errors
    // Log the error for investigation
    return NextResponse.json(
      { received: true, error: 'Internal processing error' },
      { status: 200 }
    );
  }
}

/**
 * GET endpoint to verify webhook is accessible
 */
export async function GET() {
  return NextResponse.json({
    service: 'Mixam Webhook Handler',
    status: 'ready',
    timestamp: new Date().toISOString(),
    endpoint: '/api/webhooks/mixam',
    expectedPayload: {
      orderId: 'Mixam order ID',
      status: 'Order status (PENDING, INPRODUCTION, DISPATCHED, etc.)',
      metadata: {
        externalOrderId: 'Your order ID',
      },
    },
  });
}
