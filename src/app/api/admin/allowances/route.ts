import { z } from 'zod';
import { ENTITLEMENT_COMPONENT_LIST } from '@/lib/catalog/entitlement-components';
import { getDb } from '@/server/data/db';
import { adjustAllowance, getFamilyAllowances, type AdminAllowanceDeps } from '@/server/entitlements/admin-allowances';
import { BadRequestError } from '@/server/errors';
import { withRoute } from '@/server/http';

async function deps(): Promise<AdminAllowanceDeps> {
  const db = await getDb(); // also initialises the Admin app for getAuth()
  const { getAuth } = await import('firebase-admin/auth');
  return {
    db,
    findAccount: async (emailOrUid) => {
      try {
        const user = emailOrUid.includes('@') ? await getAuth().getUserByEmail(emailOrUid) : await getAuth().getUser(emailOrUid);
        return { uid: user.uid, email: user.email ?? null };
      } catch (error) {
        if ((error as { code?: string })?.code === 'auth/user-not-found') return null;
        throw error;
      }
    },
    now: () => new Date(),
  };
}

/**
 * GET /api/admin/allowances?q=<email or uid> — one family's allowances: family
 * pool and each child's own balances, and the recent grant history. Admin only.
 */
export const GET = withRoute({ auth: 'admin', name: 'admin.allowances.get' }, async ({ request }) => {
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q) throw new BadRequestError('Pass q=<email or uid>', { code: 'QUERY_REQUIRED' });
  return getFamilyAllowances(await deps(), q);
});

const COMPONENT_KEYS = ENTITLEMENT_COMPONENT_LIST.map((c) => c.key) as [string, ...string[]];

const AdjustBody = z.object({
  uid: z.string().min(1),
  childId: z.string().min(1).optional(),
  component: z.enum(COMPONENT_KEYS),
  mode: z.enum(['add', 'setRemaining']),
  quantity: z.number().int().min(-1000).max(1000),
  reason: z.string().trim().min(3).max(300),
});

/**
 * POST /api/admin/allowances — adjust one balance, recorded in the family's
 * grant history with the admin and the reason. Returns the family's allowances.
 */
export const POST = withRoute({ auth: 'admin', body: AdjustBody, name: 'admin.allowances.adjust' }, async ({ user, body }) =>
  adjustAllowance(await deps(), { uid: user.uid, email: user.email }, body as Parameters<typeof adjustAllowance>[2])
);
