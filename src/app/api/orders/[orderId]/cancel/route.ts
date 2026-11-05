import { cancelOrder, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

/** POST /api/orders/{orderId}/cancel — Cancel before the order goes to the printer: card payments are refunded through Stripe, credits returned (409 ORDER_NOT_CANCELLABLE after submission). */
export const POST = withRoute<'user', undefined, { orderId: string }>(
  { auth: 'user', name: 'orders.cancelOrder' },
  async ({ user, params }) => cancelOrder(await getOrderDeps(), user, params.orderId)
);
