/**
 * The Stripe calls orders need, behind one small interface (ADR-0012), so the
 * service is tested with `FakeStripeGateway` and TEST_MODE runs without keys.
 * The real gateway is built from `STRIPE_SECRET_KEY`; webhooks are verified
 * with `STRIPE_WEBHOOK_SECRET`.
 */
import { randomUUID } from 'node:crypto';

export type CheckoutRequest = {
  orderId: string;
  /** Stripe Price id when the catalogue Price has one; else `price_data` with the amount below. */
  externalPriceId: string | null;
  unitAmountMinor: number;
  quantity: number;
  currency: string;
  productName: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

/** The parts of a Stripe event the order service reads. */
export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export interface StripeGateway {
  readonly mode: 'test' | 'live' | 'fake';
  createCheckoutSession(request: CheckoutRequest): Promise<{ id: string; url: string }>;
  refund(paymentIntentId: string, idempotencyKey: string): Promise<{ id: string }>;
  /** Verify the signature and parse; throws on a bad signature. */
  constructEvent(rawBody: string, signature: string | null): StripeEvent;
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super('Card payments are not set up yet');
    this.name = 'StripeNotConfiguredError';
  }
}

export function stripeModeFromKey(key: string | undefined): 'test' | 'live' | null {
  if (!key) return null;
  return key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test';
}

/** The real gateway, built lazily from env so a missing key fails a payment, not the app. */
export async function createStripeGateway(env: Record<string, string | undefined> = process.env): Promise<StripeGateway | null> {
  const key = env.STRIPE_SECRET_KEY;
  const mode = stripeModeFromKey(key);
  if (!key || !mode) return null;
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(key);
  return {
    mode,
    async createCheckoutSession(request) {
      const lineItem = request.externalPriceId
        ? { price: request.externalPriceId, quantity: request.quantity }
        : {
            price_data: { currency: request.currency.toLowerCase(), unit_amount: request.unitAmountMinor, product_data: { name: request.productName } },
            quantity: request.quantity,
          };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [lineItem],
          client_reference_id: request.orderId,
          metadata: { orderId: request.orderId },
          payment_intent_data: { metadata: { orderId: request.orderId } },
          customer_email: request.customerEmail,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
        },
        { idempotencyKey: request.idempotencyKey }
      );
      if (!session.url) throw new Error('Stripe returned a Checkout Session without a URL');
      return { id: session.id, url: session.url };
    },
    async refund(paymentIntentId, idempotencyKey) {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
      return { id: refund.id };
    },
    constructEvent(rawBody, signature) {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret) throw new StripeNotConfiguredError();
      if (!signature) throw new Error('Missing Stripe-Signature header');
      return stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEvent;
    },
  };
}

/**
 * In-memory Stripe for tests and TEST_MODE: Checkout "succeeds" by sending
 * the app a `checkout.session.completed` event through `completeCheckout`.
 * Signatures are the literal string `fake`.
 */
export class FakeStripeGateway implements StripeGateway {
  readonly mode = 'fake' as const;
  readonly sessions = new Map<string, CheckoutRequest & { paymentIntentId: string }>();
  readonly refunds: Array<{ id: string; paymentIntentId: string; idempotencyKey: string }> = [];
  private readonly byIdempotencyKey = new Map<string, string>();

  async createCheckoutSession(request: CheckoutRequest) {
    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    const id = existing ?? `cs_fake_${randomUUID().slice(0, 8)}`;
    if (!existing) {
      this.byIdempotencyKey.set(request.idempotencyKey, id);
      this.sessions.set(id, { ...request, paymentIntentId: `pi_fake_${randomUUID().slice(0, 8)}` });
    }
    return { id, url: `https://checkout.stripe.test/${id}` };
  }

  async refund(paymentIntentId: string, idempotencyKey: string) {
    const existing = this.refunds.find((r) => r.idempotencyKey === idempotencyKey);
    if (existing) return { id: existing.id };
    const refund = { id: `re_fake_${randomUUID().slice(0, 8)}`, paymentIntentId, idempotencyKey };
    this.refunds.push(refund);
    return { id: refund.id };
  }

  constructEvent(rawBody: string, signature: string | null): StripeEvent {
    if (signature !== 'fake') throw new Error('Bad signature');
    return JSON.parse(rawBody) as StripeEvent;
  }

  /** The event Stripe would send when the session is paid. */
  completedEvent(sessionId: string, eventId = `evt_${randomUUID().slice(0, 8)}`): StripeEvent {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No fake session ${sessionId}`);
    return {
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          client_reference_id: session.orderId,
          metadata: { orderId: session.orderId },
          payment_status: 'paid',
          payment_intent: session.paymentIntentId,
          amount_total: session.unitAmountMinor * session.quantity,
          currency: session.currency.toLowerCase(),
        },
      },
    };
  }

  /** The event Stripe sends once a refund has gone through. */
  refundedEvent(paymentIntentId: string, eventId = `evt_${randomUUID().slice(0, 8)}`): StripeEvent {
    return { id: eventId, type: 'charge.refunded', data: { object: { id: `ch_fake`, payment_intent: paymentIntentId, refunded: true } } };
  }
}
