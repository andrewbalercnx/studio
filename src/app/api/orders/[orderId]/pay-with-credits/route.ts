import { payWithCredits, getOrderDeps } from '@/server/orders';
import { withRoute } from '@/server/http';

/** POST /api/orders/{orderId}/pay-with-credits — Pay with print credits, one per copy (402 ENTITLEMENT_LIMIT when there are not enough). */
export const POST = withRoute<'user', undefined, { orderId: string }>(
  { auth: 'user', name: 'orders.payWithCredits' },
  async ({ user, params }) => payWithCredits(await getOrderDeps(), user, params.orderId)
);
