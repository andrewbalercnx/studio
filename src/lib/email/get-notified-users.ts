import type { UserProfile } from '@/lib/types';

/**
 * Get all users who should receive admin notifications for print orders.
 * Uses Firebase Admin SDK (server-side only).
 */
export async function getNotifiedUsers(
  firestore: FirebaseFirestore.Firestore
): Promise<UserProfile[]> {
  try {
    const snapshot = await firestore
      .collection('users')
      .where('notifiedUser', '==', true)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    } as UserProfile));
  } catch (error: any) {
    console.error('[Email] Failed to get notified users:', error.message);
    return [];
  }
}

/**
 * Get email addresses for all notified users.
 * Filters out any users without email addresses.
 */
export async function getNotifiedEmails(
  firestore: FirebaseFirestore.Firestore
): Promise<string[]> {
  const users = await getNotifiedUsers(firestore);
  return users
    .map(u => u.email)
    .filter((email): email is string => !!email);
}
