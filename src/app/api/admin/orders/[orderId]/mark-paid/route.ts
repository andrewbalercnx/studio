import { z } from 'zod';
import { getOrderDeps, markOrderPaid } from '@/server/orders';
import { withRoute } from '@/server/http';

const Body = z.object({ note: z.string().min(1).max(500) });

/** POST /api/admin/orders/{orderId}/mark-paid — audited: mark an order awaiting payment as paid (e.g. bank transfer); the note is required and kept on the order. */
export const POST = withRoute<'admin', typeof Body, { orderId: string }>(
  { auth: 'admin', body: Body, name: 'admin.orders.markPaid' },
  async ({ user, body, params }) => markOrderPaid(await getOrderDeps(), user, params.orderId, body.note)
);
