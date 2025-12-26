import { NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { PrintOrder, MixamOrderStatus } from '@/lib/types';

/**
 * Mixam Webhook Handler
 * Receives status updates from Mixam for print orders
 *
 * Webhook events from Mixam:
 * - file.validation_passed
 * - file.validation_failed
 * - order.confirmed
 * - order.in_production
 * - order.shipped
 * - order.delivered
 * - order.cancelled
 */

type MixamWebhookEvent =
  | 'file.validation_passed'
  | 'file.validation_failed'
  | 'order.confirmed'
  | 'order.in_production'
  | 'order.shipped'
  | 'order.delivered'
  | 'order.cancelled';

type MixamWebhookPayload = {
  event: MixamWebhookEvent;
  timestamp: string;
  orderId: string; // This is our referencedJobNumber (our order ID)
  mixamJobNumber?: string;
  data: {
    status: string;
    trackingNumber?: string;
    carrier?: string;
    trackingUrl?: string;
    estimatedDelivery?: string;
    validationErrors?: string[];
    message?: string;
  };
};

/**
 * Verifies webhook signature from Mixam
 * Uses HMAC-SHA256 with shared secret
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
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

/**
 * Maps Mixam event to our order status
 */
function mapMixamEventToStatus(event: MixamWebhookEvent): MixamOrderStatus {
  const statusMap: Record<MixamWebhookEvent, MixamOrderStatus> = {
    'file.validation_passed': 'ready_to_submit',
    'file.validation_failed': 'validation_failed',
    'order.confirmed': 'confirmed',
    'order.in_production': 'in_production',
    'order.shipped': 'shipped',
    'order.delivered': 'delivered',
    'order.cancelled': 'cancelled',
  };

  return statusMap[event] || 'submitted';
}

/**
 * Sends email notification to admin about order status change
 */
async function notifyAdminOfStatusChange(
  order: PrintOrder,
  newStatus: MixamOrderStatus,
  message?: string
) {
  // TODO: Implement email notification
  // For now, just log
  console.log(`[Mixam Webhook] Order ${order.id} status changed to ${newStatus}`);
  console.log(`[Mixam Webhook] Notification admin: ${order.notificationAdminUid}`);

  if (message) {
    console.log(`[Mixam Webhook] Message: ${message}`);
  }
}

export async function POST(request: Request) {
  try {
    await initFirebaseAdminApp();

    // 1. Read raw body for signature verification
    const rawBody = await request.text();

    // 2. Verify webhook signature
    const signature = request.headers.get('X-Mixam-Signature') || '';
    const webhookSecret = process.env.MIXAM_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Mixam Webhook] MIXAM_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Webhook not configured' },
        { status: 500 }
      );
    }

    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('[Mixam Webhook] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // 3. Parse webhook payload
    const webhook: MixamWebhookPayload = JSON.parse(rawBody);

    console.log(`[Mixam Webhook] Received event: ${webhook.event} for order ${webhook.orderId}`);

    // 4. Find the print order
    const firestore = getFirestore();
    const orderDoc = await firestore.collection('printOrders').doc(webhook.orderId).get();

    if (!orderDoc.exists) {
      console.error(`[Mixam Webhook] Order not found: ${webhook.orderId}`);
      // Return 200 anyway to prevent Mixam retries
      return NextResponse.json({ received: true });
    }

    const order = { id: orderDoc.id, ...orderDoc.data() } as PrintOrder;

    // 5. Map event to status
    const newStatus = mapMixamEventToStatus(webhook.event);

    // 6. Update order in Firestore
    const updateData: any = {
      fulfillmentStatus: newStatus,
      mixamStatus: webhook.data.status,
      fulfillmentUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add status to history
    updateData.statusHistory = FieldValue.arrayUnion({
      status: newStatus,
      timestamp: FieldValue.serverTimestamp(),
      note: webhook.data.message || `Webhook: ${webhook.event}`,
      source: 'webhook',
    });

    // Update tracking information if provided
    if (webhook.data.trackingNumber) {
      updateData.mixamTrackingNumber = webhook.data.trackingNumber;
    }

    if (webhook.data.carrier) {
      updateData.mixamCarrier = webhook.data.carrier;
    }

    if (webhook.data.trackingUrl) {
      updateData.mixamTrackingUrl = webhook.data.trackingUrl;
    }

    if (webhook.data.estimatedDelivery) {
      updateData.mixamEstimatedDelivery = webhook.data.estimatedDelivery;
    }

    // Update Mixam job number if provided
    if (webhook.mixamJobNumber) {
      updateData.mixamJobNumber = webhook.mixamJobNumber;
    }

    // Handle validation failures
    if (webhook.event === 'file.validation_failed' && webhook.data.validationErrors) {
      updateData.fulfillmentNotes = webhook.data.validationErrors.join('; ');
      updateData.mixamValidation = {
        valid: false,
        errors: webhook.data.validationErrors,
        warnings: [],
        checkedAt: Date.now(),
      };
    }

    await orderDoc.ref.update(updateData);

    // 7. Send notification to admin for important status changes
    const notifiableStatuses: MixamOrderStatus[] = [
      'validation_failed',
      'confirmed',
      'shipped',
      'delivered',
      'cancelled',
    ];

    if (notifiableStatuses.includes(newStatus)) {
      await notifyAdminOfStatusChange(order, newStatus, webhook.data.message);
    }

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
              event: 'print_order.status_update',
              status: 'completed',
              source: 'webhook',
              attributes: {
                orderId: order.id,
                newStatus,
                mixamEvent: webhook.event,
              },
              createdAt: FieldValue.serverTimestamp(),
            });
        }
      } catch (error) {
        console.warn('[Mixam Webhook] Failed to log session event', error);
      }
    }

    console.log(`[Mixam Webhook] Successfully processed ${webhook.event} for order ${webhook.orderId}`);

    return NextResponse.json({ received: true });

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
  });
}
