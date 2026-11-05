import { z } from 'zod';
import { adminCancelOrder, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

const Body = z.object({ note: z.string().max(500).nullable().optional() });

/** POST /api/admin/orders/{orderId}/cancel — cancel any order not yet shipped (at Mixam first if submitted); refunds card payments, returns credits. */
export const POST = withRoute<'admin', typeof Body, { orderId: string }>(
  { auth: 'admin', body: Body, name: 'admin.orders.cancel' },
  async ({ user, body, params }) => adminCancelOrder(await getOrderDeps(), user, params.orderId, body.note ?? null)
);
