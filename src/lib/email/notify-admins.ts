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
  const email = await orderSubmittedTemplate(order);
  if (!email) {
    console.log('[Email] Order submitted notification disabled, skipping');
    return;
  }
  await notifyAdmins(firestore, email.subject, email.html);
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
  const email = await orderStatusChangedTemplate(order, oldStatus, newStatus);
  if (!email) {
    console.log('[Email] Order status changed notification disabled, skipping');
    return;
  }
  await notifyAdmins(firestore, email.subject, email.html);
}

/**
 * Notify admins about an approved order.
 */
export async function notifyOrderApproved(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder
): Promise<void> {
  const email = await orderApprovedTemplate(order);
  if (!email) {
    console.log('[Email] Order approved notification disabled, skipping');
    return;
  }
  await notifyAdmins(firestore, email.subject, email.html);
}

/**
 * Notify admins about a rejected order.
 */
export async function notifyOrderRejected(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder,
  reason?: string
): Promise<void> {
  const email = await orderRejectedTemplate(order, reason);
  if (!email) {
    console.log('[Email] Order rejected notification disabled, skipping');
    return;
  }
  await notifyAdmins(firestore, email.subject, email.html);
}

/**
 * Notify admins about a cancelled order.
 */
export async function notifyOrderCancelled(
  firestore: FirebaseFirestore.Firestore,
  order: PrintOrder,
  reason?: string
): Promise<void> {
  const email = await orderCancelledTemplate(order, reason);
  if (!email) {
    console.log('[Email] Order cancelled notification disabled, skipping');
    return;
  }
  await notifyAdmins(firestore, email.subject, email.html);
}
