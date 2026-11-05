import { getOrderDeps, refreshFromMixam } from '@/server/orders';
import { withRoute } from '@/server/http';

/** POST /api/admin/orders/{orderId}/refresh — ask Mixam for the order's status and apply it (forward only). */
export const POST = withRoute<'admin', undefined, { orderId: string }>(
  { auth: 'admin', name: 'admin.orders.refresh' },
  async ({ params }) => refreshFromMixam(await getOrderDeps(), params.orderId)
);
