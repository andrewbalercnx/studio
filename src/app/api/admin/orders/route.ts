import { getOrderDeps, listAdminOrders } from '@/server/orders';
import { ORDER_STATUSES, type OrderStatus } from '@/server/data/schemas/order';
import { withRoute } from '@/server/http';

/** GET /api/admin/orders[?status=] — every print order (schemaVersion 2), newest first, with the admin's next action. Admin only. */
export const GET = withRoute({ auth: 'admin', name: 'admin.orders.list' }, async ({ request }) => {
  const status = new URL(request.url).searchParams.get('status');
  const filter = status && (ORDER_STATUSES as readonly string[]).includes(status) ? (status as OrderStatus) : null;
  return listAdminOrders(await getOrderDeps(), { status: filter });
});
