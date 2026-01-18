import { FieldValue } from 'firebase-admin/firestore';
import type { MixamInteraction } from '@/lib/types';
import type { MixamApiInteraction } from './client';

/**
 * Generates a unique ID for a Mixam interaction
 */
function generateInteractionId(): string {
  return `mxi_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Converts MixamApiInteraction from client to MixamInteraction for Firestore
 */
export function toMixamInteraction(apiInteraction: MixamApiInteraction, orderId?: string): MixamInteraction {
  return {
    id: generateInteractionId(),
    timestamp: apiInteraction.timestamp,
    type: apiInteraction.type,
    method: apiInteraction.method,
    endpoint: apiInteraction.endpoint,
    requestBody: apiInteraction.requestBody,
    statusCode: apiInteraction.statusCode,
    responseBody: apiInteraction.responseBody,
    durationMs: apiInteraction.durationMs,
    error: apiInteraction.error,
    action: apiInteraction.action,
    orderId,
  };
}

/**
 * Converts an array of MixamApiInteraction to MixamInteraction for Firestore
 */
export function toMixamInteractions(apiInteractions: MixamApiInteraction[], orderId?: string): MixamInteraction[] {
  return apiInteractions.map(i => toMixamInteraction(i, orderId));
}

/**
 * Creates a MixamInteraction object for a webhook event
 */
export function createWebhookInteraction(params: {
  webhookEvent: string;
  webhookPayload: any;
  orderId?: string;
}): MixamInteraction {
  return {
    id: generateInteractionId(),
    timestamp: new Date().toISOString(),
    type: 'webhook',
    webhookEvent: params.webhookEvent,
    webhookPayload: params.webhookPayload,
    action: `Webhook: ${params.webhookEvent}`,
    orderId: params.orderId,
  };
}

/**
 * Logs a Mixam interaction to the order's mixamInteractions array in Firestore
 */
export async function logMixamInteraction(
  firestore: FirebaseFirestore.Firestore,
  printOrderId: string,
  interaction: MixamInteraction
): Promise<void> {
  try {
    const orderRef = firestore.collection('printOrders').doc(printOrderId);

    await orderRef.update({
      mixamInteractions: FieldValue.arrayUnion(interaction),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[Mixam] Logged interaction ${interaction.id} (${interaction.type}) for order ${printOrderId}`);
  } catch (error: any) {
    // Don't fail the main operation if logging fails
    console.warn(`[Mixam] Failed to log interaction for order ${printOrderId}:`, error.message);
  }
}

/**
 * Logs multiple Mixam interactions at once (e.g., request + response pair)
 */
export async function logMixamInteractions(
  firestore: FirebaseFirestore.Firestore,
  printOrderId: string,
  interactions: MixamInteraction[]
): Promise<void> {
  if (!interactions || interactions.length === 0) {
    console.log(`[Mixam] No interactions to log for order ${printOrderId}`);
    return;
  }

  try {
    const orderRef = firestore.collection('printOrders').doc(printOrderId);

    console.log(`[Mixam] Logging ${interactions.length} interactions for order ${printOrderId}:`,
      interactions.map(i => `${i.type}:${i.action}`).join(', '));

    await orderRef.update({
      mixamInteractions: FieldValue.arrayUnion(...interactions),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[Mixam] Successfully logged ${interactions.length} interactions for order ${printOrderId}`);
  } catch (error: any) {
    console.error(`[Mixam] Failed to log interactions for order ${printOrderId}:`, error.message, error);
  }
}
