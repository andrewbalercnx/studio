import { getNotifiedEmails } from './get-notified-users';
import { sendEmail } from './send-email';
import type { PrintOrder } from '@/lib/types';
import {
  orderSubmittedTemplate,
  orderStatusChangedTemplate,
  orderApprovedTemplate,
  orderRejectedTemplate,
  orderCancelledTemplate,
} from './templates';

/**
 * Send a notification email to all configured admin users.
 */
export async function notifyAdmins(
  firestore: FirebaseFirestore.Firestore,
  subject: string,
  html: string
): Promise<void> {
  const emails = await getNotifiedEmails(firestore);

  if (emails.length === 0) {
    console.log('[Email] No notified users configured, skipping notification');
    return;
  }

  try {
    await sendEmail({ to: emails, subject, html });
    console.log(`[Email] Notification sent to ${emails.length} admin(s)`);
  } catch (error: any) {
    console.error(`[Email] Failed to notify admins: ${error.message}`);
    // Don't throw - email failures shouldn't break the main flow
  }
}

/**
 * Notify admins about a new print order submission.
 */
export async function notifyOrderSubmitted(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder
): Promise<void> {
  await notifyAdmins(
    firestore,
    `New Print Order: ${order.id}`,
    orderSubmittedTemplate(order)
  );
}

/**
 * Notify admins about an order status change (from Mixam webhook).
 */
export async function notifyOrderStatusChanged(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  await notifyAdmins(
    firestore,
    `Print Order Status: ${order.id} - ${newStatus.replace(/_/g, ' ')}`,
    orderStatusChangedTemplate(order, oldStatus, newStatus)
  );
}

/**
 * Notify admins about an approved order.
 */
export async function notifyOrderApproved(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder
): Promise<void> {
  await notifyAdmins(
    firestore,
    `Print Order Approved: ${order.id}`,
    orderApprovedTemplate(order)
  );
}

/**
 * Notify admins about a rejected order.
 */
export async function notifyOrderRejected(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder,
  reason?: string
): Promise<void> {
  await notifyAdmins(
    firestore,
    `Print Order Rejected: ${order.id}`,
    orderRejectedTemplate(order, reason)
  );
}

/**
 * Notify admins about a cancelled order.
 */
export async function notifyOrderCancelled(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder,
  reason?: string
): Promise<void> {
  await notifyAdmins(
    firestore,
    `Print Order Cancelled: ${order.id}`,
    orderCancelledTemplate(order, reason)
  );
}
