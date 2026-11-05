import { z } from 'zod';
import { getOrderDeps, getOrderSettings, updateOrderSettings } from '@/server/orders';
import { withRoute } from '@/server/http';

const Body = z.object({
  requireAdminApproval: z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).max(20).optional(),
});

/** GET /api/admin/orders/settings — the approval switch, approval emails and the Stripe mode (test/live/fake, or null when not configured). Admin only. */
export const GET = withRoute({ auth: 'admin', name: 'admin.orders.settings.get' }, async () => getOrderSettings(await getOrderDeps()));

/** PUT /api/admin/orders/settings — change the approval switch or the approval emails (`systemConfig/orders`). Admin only. */
export const PUT = withRoute({ auth: 'admin', body: Body, name: 'admin.orders.settings.put' }, async ({ body }) =>
  updateOrderSettings(await getOrderDeps(), body)
);
