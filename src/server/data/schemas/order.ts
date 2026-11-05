import { z } from 'zod';
import { ownerFields, stampFields } from './common';

/**
 * PrintOrder lifecycle (slice 5.5b, pipeline.md):
 *
 *   created ─▶ rendering ─▶ awaiting_payment ─▶ paid ─▶ [awaiting_approval] ─▶ submitting ─▶ submitted
 *                                  │                              ─▶ in_production ─▶ shipped ─▶ delivered
 *                                  └▶ cancelled      any paid state before delivery ─▶ cancelled ─▶ refunded
 *
 * `awaiting_approval` only while `systemConfig/orders.requireAdminApproval` is on.
 * `refunded` only from the Stripe webhook.
 */
export const ORDER_STATUSES = [
  'rendering',
  'awaiting_payment',
  'paid',
  'awaiting_approval',
  'submitting',
  'submitted',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(120),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().default(null),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).nullable().default(null),
  postalCode: z.string().trim().min(2).max(16),
  country: z.literal('GB').default('GB'),
});
export type OrderAddress = z.infer<typeof addressSchema>;

export const PAYMENT_METHODS = ['stripe', 'credit', 'admin'] as const;

export const orderPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS).nullable().default(null),
  checkoutSessionId: z.string().nullable().default(null),
  paymentIntentId: z.string().nullable().default(null),
  paidAt: z.string().nullable().default(null),
  /** Print credits spent, and the pool they came from, so a cancel can return them. */
  credits: z.object({ quantity: z.number().int().positive(), source: z.enum(['child', 'family']), returned: z.boolean().default(false) }).nullable().default(null),
  refundId: z.string().nullable().default(null),
  refundedAt: z.string().nullable().default(null),
  /** Audited admin mark-paid. */
  markedPaidBy: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
});
export type OrderPayment = z.infer<typeof orderPaymentSchema>;

export const statusEntrySchema = z.object({
  status: orderStatusSchema,
  at: z.string(),
  /** `system`, `stripe`, `mixam`, or the uid of the person who did it. */
  by: z.string(),
  note: z.string().nullable().default(null),
});
export type StatusEntry = z.infer<typeof statusEntrySchema>;

/** `printOrders/{orderId}` (schemaVersion 2): server-written only. */
export const printOrderSchema = z.object({
  ...ownerFields,
  schemaVersion: z.literal(2),
  bookId: z.string().min(1),
  childId: z.string().min(1),
  /** The render this order prints (ADR-0010: pinned, immutable). */
  renderId: z.string().min(1),
  layoutId: z.string().min(1),
  printProductId: z.string().min(1),
  productId: z.string().min(1),
  priceId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
  unitAmountMinor: z.number().int().nonnegative(),
  /** Charged in total: unit × quantity, VAT and UK delivery included. */
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().min(3).max(3),
  shippingAddress: addressSchema,
  contactEmail: z.string().email(),
  status: orderStatusSchema,
  statusHistory: z.array(statusEntrySchema).default([]),
  payment: orderPaymentSchema.default({}),
  approval: z
    .object({
      required: z.boolean(),
      approvedBy: z.string().nullable().default(null),
      approvedAt: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  mixam: z
    .object({
      orderId: z.string().nullable().default(null),
      jobNumber: z.string().nullable().default(null),
      status: z.string().nullable().default(null),
      trackingUrl: z.string().nullable().default(null),
      /** Set just before the submit request goes out: a later attempt must look the order up first. */
      requestStartedAt: z.string().nullable().default(null),
      submittedAt: z.string().nullable().default(null),
      lastError: z.string().nullable().default(null),
    })
    .default({}),
  idempotencyKey: z.string().min(1),
  ...stampFields,
});
export type PrintOrderV2 = z.infer<typeof printOrderSchema>;

/** `stripeEvents/{eventId}`: each Stripe event is applied once. */
export const stripeEventSchema = z.object({
  type: z.string(),
  orderId: z.string().nullable().default(null),
  outcome: z.string(),
  ...stampFields,
});
