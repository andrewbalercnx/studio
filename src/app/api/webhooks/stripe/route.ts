import { NextResponse } from 'next/server';
import { getOrderDeps, handleStripeEvent } from '@/server/orders';
import { AppError } from '@/server/errors';

/**
 * POST /api/webhooks/stripe — Stripe events for print orders (ADR-0012).
 * Verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` on the raw body
 * (400 when it fails), applies each event id once (`stripeEvents/{eventId}`):
 * `checkout.session.completed` → paid; `charge.refunded` → refunded. 503 while
 * Stripe is not configured; 500 on internal errors, so Stripe retries.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const result = await handleStripeEvent(await getOrderDeps(), rawBody, request.headers.get('stripe-signature'));
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error('[Stripe Webhook] Failed', (error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL', message: 'Internal error' } }, { status: 500 });
  }
}
