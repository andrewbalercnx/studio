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
 * Note: We must filter out undefined values as Firestore doesn't accept them
 */
export function toMixamInteraction(apiInteraction: MixamApiInteraction, orderId?: string): MixamInteraction {
  const interaction: MixamInteraction = {
    id: generateInteractionId(),
    timestamp: apiInteraction.timestamp,
    type: apiInteraction.type,
  };

  // Only add defined values (Firestore rejects undefined)
  if (apiInteraction.method !== undefined) interaction.method = apiInteraction.method;
  if (apiInteraction.endpoint !== undefined) interaction.endpoint = apiInteraction.endpoint;
  if (apiInteraction.requestBody !== undefined) interaction.requestBody = apiInteraction.requestBody;
  if (apiInteraction.statusCode !== undefined) interaction.statusCode = apiInteraction.statusCode;
  if (apiInteraction.responseBody !== undefined) interaction.responseBody = apiInteraction.responseBody;
  if (apiInteraction.durationMs !== undefined) interaction.durationMs = apiInteraction.durationMs;
  if (apiInteraction.error !== undefined) interaction.error = apiInteraction.error;
  if (apiInteraction.action !== undefined) interaction.action = apiInteraction.action;
  if (orderId !== undefined) interaction.orderId = orderId;

  return interaction;
}

/**
 * Converts an array of MixamApiInteraction to MixamInteraction for Firestore
 */
export function toMixamInteractions(apiInteractions: MixamApiInteraction[], orderId?: string): MixamInteraction[] {
  return apiInteractions.map(i => toMixamInteraction(i, orderId));
}

/**
 * Creates a MixamInteraction object for a webhook event
 * Note: We must filter out undefined values as Firestore doesn't accept them
 */
export function createWebhookInteraction(params: {
  webhookEvent: string;
  webhookPayload: any;
  orderId?: string;
}): MixamInteraction {
  const interaction: MixamInteraction = {
    id: generateInteractionId(),
    timestamp: new Date().toISOString(),
    type: 'webhook',
    webhookEvent: params.webhookEvent,
    webhookPayload: params.webhookPayload,
    action: `Webhook: ${params.webhookEvent}`,
  };

  // Only add orderId if defined (Firestore rejects undefined)
  if (params.orderId !== undefined) {
    interaction.orderId = params.orderId;
  }

  return interaction;
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

    // Log the interaction IDs and types for debugging
    interactions.forEach((i, idx) => {
      console.log(`[Mixam]   ${idx + 1}. ${i.type} - ${i.action} (id: ${i.id})`);
    });

    await orderRef.update({
      mixamInteractions: FieldValue.arrayUnion(...interactions),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[Mixam] Successfully logged ${interactions.length} interactions for order ${printOrderId}`);
  } catch (error: any) {
    // Log full error details to help diagnose issues
    console.error(`[Mixam] FAILED to log interactions for order ${printOrderId}:`, {
      errorMessage: error.message,
      errorCode: error.code,
      errorDetails: error.details,
      interactionCount: interactions.length,
      interactionTypes: interactions.map(i => i.type),
    });
    console.error(`[Mixam] Full error:`, error);
  }
}
