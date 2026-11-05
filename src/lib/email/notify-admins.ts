import { getNotifiedEmails, getMaintenanceEmails } from './get-notified-users';
import { sendEmail } from './send-email';
import {
  maintenanceErrorTemplate,
  type MaintenanceErrorDetails,
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
 * Send a notification email to all configured maintenance users.
 */
export async function notifyMaintenanceUsers(
  firestore: FirebaseFirestore.Firestore,
  subject: string,
  html: string
): Promise<void> {
  const emails = await getMaintenanceEmails(firestore);

  if (emails.length === 0) {
    console.log('[Email] No maintenance users configured, skipping notification');
    return;
  }

  try {
    await sendEmail({ to: emails, subject, html });
    console.log(`[Email] Maintenance notification sent to ${emails.length} user(s)`);
  } catch (error: any) {
    console.error(`[Email] Failed to notify maintenance users: ${error.message}`);
    // Don't throw - email failures shouldn't break the main flow
  }
}

/**
 * Notify maintenance users about a system error.
 * This function is designed to be called from AI flows and other server-side processes
 * when errors occur that require attention.
 */
export async function notifyMaintenanceError(
  firestore: FirebaseFirestore.Firestore,
  details: MaintenanceErrorDetails
): Promise<void> {
  const email = await maintenanceErrorTemplate(details);
  if (!email) {
    console.log('[Email] Maintenance error notification disabled, skipping');
    return;
  }
  await notifyMaintenanceUsers(firestore, email.subject, email.html);
}

// Re-export MaintenanceErrorDetails type for convenience
export type { MaintenanceErrorDetails };
