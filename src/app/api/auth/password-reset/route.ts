import { z } from 'zod';
import { getDb } from '@/server/data/db';
import { appBaseUrl, sendPasswordReset } from '@/server/auth-email/password-reset';
import { withRoute } from '@/server/http';

const Body = z.object({ email: z.string().trim().email().max(254) });

/**
 * POST /api/auth/password-reset — sends a StoryPic password reset email whose
 * link opens /auth/action on our domain (src/server/auth-email/password-reset.ts).
 * Public. Always `{ ok: true, data: { sent: true } }` for a valid address,
 * whether or not it has an account, and at most once a minute per address.
 */
export const POST = withRoute({ auth: 'public', body: Body, name: 'auth.password-reset' }, async ({ body }) => {
  const db = await getDb(); // also initialises the Admin app for getAuth()
  const { getAuth } = await import('firebase-admin/auth');
  const { sendEmail } = await import('@/lib/email/send-email');
  await sendPasswordReset(
    {
      db,
      generateLink: (email) => getAuth().generatePasswordResetLink(email),
      sendEmail,
      now: Date.now,
      baseUrl: appBaseUrl(),
    },
    body.email
  );
  return { sent: true };
});
