import { z } from 'zod';
import { createOrder, getOrderDeps, listOrders } from '@/server/orders';
import { ok, withRoute } from '@/server/http';

const Body = z.object({
  bookId: z.string().min(1),
  layoutId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  shippingAddress: z.object({
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().nullable().optional(),
    city: z.string().min(1),
    state: z.string().nullable().optional(),
    postalCode: z.string().min(1),
    country: z.literal('GB').optional(),
  }),
  contactEmail: z.string().email().nullable().optional(),
  // One per "place order" tap: a repeat returns the same order.
  idempotencyKey: z.string().min(8).max(128),
});

/**
 * POST /api/orders — order printed copies of a Book in a template (UK delivery,
 * price from the catalogue, VAT and delivery included). Starts the order's own
 * print render, which locks the Book; the order waits for payment once the
 * files exist. Response 201: `{ ok: true, data: OrderView }`.
 */
export const POST = withRoute({ auth: 'user', body: Body, name: 'orders.create' }, async ({ user, body }) => {
  const order = await createOrder(await getOrderDeps(), user, body);
  return ok(order, 201);
});

/** GET /api/orders — the family's print orders, newest first. */
export const GET = withRoute({ auth: 'user', name: 'orders.list' }, async ({ user }) => listOrders(await getOrderDeps(), user));
