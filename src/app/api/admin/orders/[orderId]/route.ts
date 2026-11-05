import { getAdminOrder, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

/** GET /api/admin/orders/{orderId} — one order in full (payment, approval, Mixam). Admin only. */
export const GET = withRoute<'admin', undefined, { orderId: string }>(
  { auth: 'admin', name: 'admin.orders.get' },
  async ({ params }) => getAdminOrder(await getOrderDeps(), params.orderId)
);
