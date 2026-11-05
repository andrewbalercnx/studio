import { getOrder, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

/** GET /api/orders/{orderId} — one order with its timeline, proof links and the actions the parent may take. */
export const GET = withRoute<'user', undefined, { orderId: string }>(
  { auth: 'user', name: 'orders.get' },
  async ({ user, params }) => getOrder(await getOrderDeps(), user, params.orderId)
);
