/**
 * Password reset emails sent by us, not by Firebase.
 *
 * Firebase's own reset email links to its default handler on firebaseapp.com,
 * and this project may not change its templates (EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED),
 * so the link cannot be pointed at our domain. Instead the Admin SDK makes the
 * one-time code, we build the link to our handler (/auth/action) and send the
 * email through Microsoft Graph like every other StoryPic email.
 *
 * Never reveals whether an address has an account: an unknown address, a
 * throttled request and a sent email all look the same to the caller.
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/** One reset email per address per minute: stops the form being used to flood an inbox. */
export const RESET_THROTTLE_MS = 60_000;

/**
 * The site the link points at. Fixed, never taken from the request: a Host
 * header the caller controls would let them send a victim's code to their own site.
 */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.APP_BASE_URL || 'https://storypic.rcnx.io').replace(/\/+$/, '');
}

export type PasswordResetDeps = {
  db: Firestore;
  /** Admin SDK `generatePasswordResetLink`; throws `auth/user-not-found` for unknown addresses. */
  generateLink: (email: string) => Promise<string>;
  sendEmail: (message: { to: string; subject: string; html: string }) => Promise<void>;
  now: () => number;
  baseUrl: string;
};

export type PasswordResetOutcome = 'sent' | 'throttled' | 'no-account';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function resetEmailHtml(email: string, link: string): string {
  const safeEmail = escapeHtml(email);
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color: #3b2a14; background: #fffaf0; padding: 24px;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 28px; border: 1px solid #f3e1b9;">
    <h1 style="font-size: 22px; margin: 0 0 16px;">Reset your StoryPic Kids password</h1>
    <p>We got a request to reset the password for <strong>${safeEmail}</strong>.</p>
    <p style="margin: 24px 0;">
      <a href="${safeLink}" style="background: #f59e0b; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 600; display: inline-block;">Choose a new password</a>
    </p>
    <p style="font-size: 13px; color: #7a6a52;">The link works once and expires in an hour. If you didn't ask for this, you can ignore this email; your password stays the same.</p>
    <p style="font-size: 13px; color: #7a6a52;">The StoryPic Kids team</p>
  </div>
</body></html>`;
}

export async function sendPasswordReset(deps: PasswordResetDeps, rawEmail: string): Promise<PasswordResetOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const throttleRef = deps.db.doc(`authEmailThrottle/${createHash('sha256').update(email).digest('hex')}`);

  // Claim the slot first, so two quick requests cannot both send.
  const claimed = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef);
    const last = snap.exists ? (snap.data()?.lastSentMs as number | undefined) : undefined;
    if (typeof last === 'number' && deps.now() - last < RESET_THROTTLE_MS) return false;
    tx.set(throttleRef, { lastSentMs: deps.now(), kind: 'passwordReset' });
    return true;
  });
  if (!claimed) return 'throttled';

  let firebaseLink: string;
  try {
    firebaseLink = await deps.generateLink(email);
  } catch (error) {
    if ((error as { code?: string })?.code === 'auth/user-not-found') return 'no-account';
    throw error;
  }
  const oobCode = new URL(firebaseLink).searchParams.get('oobCode');
  if (!oobCode) throw new Error('generatePasswordResetLink returned a link without an oobCode');

  const link = `${deps.baseUrl}/auth/action?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}`;
  await deps.sendEmail({ to: email, subject: 'Reset your StoryPic Kids password', html: resetEmailHtml(email, link) });
  return 'sent';
}
