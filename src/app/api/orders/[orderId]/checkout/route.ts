import { checkout, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

/** POST /api/orders/{orderId}/checkout — Start Stripe Checkout for an order awaiting payment; returns `{ url }` to send the browser to (503 STRIPE_NOT_CONFIGURED without keys). */
export const POST = withRoute<'user', undefined, { orderId: string }>(
  { auth: 'user', name: 'orders.checkout' },
  async ({ user, params }) => checkout(await getOrderDeps(), user, params.orderId)
);
