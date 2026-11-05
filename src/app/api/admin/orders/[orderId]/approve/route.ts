import { approveOrder, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

/** POST /api/admin/orders/{orderId}/approve — approve a paid order waiting for approval; enqueues `order.submit`. */
export const POST = withRoute<'admin', undefined, { orderId: string }>(
  { auth: 'admin', name: 'admin.orders.approve' },
  async ({ user, params }) => approveOrder(await getOrderDeps(), user, params.orderId)
);
