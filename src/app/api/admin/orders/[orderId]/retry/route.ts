import { z } from 'zod';
import { getOrderDeps, retrySubmit } from '@/server/orders';
import { withRoute } from '@/server/http';

const Body = z.object({ force: z.boolean().optional() });

/**
 * POST /api/admin/orders/{orderId}/retry — submit to Mixam again (a new `order.submit` job).
 * `force: true` skips the Mixam lookup after an uncertain attempt: only once Mixam has been checked.
 */
export const POST = withRoute<'admin', typeof Body, { orderId: string }>(
  { auth: 'admin', body: Body, name: 'admin.orders.retry' },
  async ({ user, body, params }) => retrySubmit(await getOrderDeps(), user, params.orderId, body.force === true)
);
