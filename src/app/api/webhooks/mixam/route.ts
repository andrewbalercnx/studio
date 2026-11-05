import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { applyMixamStatus, getOrderDeps } from '@/server/orders';

/**
 * POST /api/webhooks/mixam — Mixam status updates for print orders (slice 5.5b).
 *
 * Signed with HMAC-SHA256 of the raw body (`X-Mixam-Signature`, secret
 * `MIXAM_WEBHOOK_SECRET`); unsigned or wrongly signed requests get 401, and
 * 503 while the secret is not configured. The order is found by our id
 * (`metadata.externalOrderId`) and must carry the Mixam order id we submitted.
 * Updates only move an order forward (submitted → in_production → shipped →
 * delivered); anything else is recorded on the order and changes nothing. A
 * shipped order emails the parent the tracking link. Unknown orders answer 200
 * so Mixam stops retrying; internal errors answer 500 so it retries.
 */
type MixamWebhookPayload = {
  orderId: string;
  status: string;
  statusReason?: string;
  metadata?: { externalOrderId?: string };
  hasErrors?: boolean;
  shipments?: Array<{ trackingUrl?: string }>;
};

function validSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.MIXAM_WEBHOOK_SECRET;
  if (!secret || secret === 'your_webhook_secret_from_mixam') {
    console.error('[Mixam Webhook] MIXAM_WEBHOOK_SECRET is not configured; rejecting request');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  if (!validSignature(rawBody, request.headers.get('X-Mixam-Signature'), secret)) {
    console.warn('[Mixam Webhook] Missing or invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let webhook: MixamWebhookPayload;
  try {
    webhook = JSON.parse(rawBody) as MixamWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const orderId = webhook.metadata?.externalOrderId;
  if (!orderId || !webhook.status) {
    return NextResponse.json({ received: true, warning: 'Missing externalOrderId or status' });
  }

  try {
    const trackingUrl = webhook.shipments?.find((s) => s.trackingUrl)?.trackingUrl ?? null;
    // Artwork errors put the order on hold at Mixam: record it, change nothing.
    const status = webhook.hasErrors ? 'ONHOLD' : webhook.status;
    const { outcome } = await applyMixamStatus(await getOrderDeps(), orderId, { mixamOrderId: String(webhook.orderId ?? ''), status, trackingUrl });
    console.log(`[Mixam Webhook] Order ${orderId}: Mixam ${webhook.status}${webhook.statusReason ? ` (${webhook.statusReason})` : ''} → ${outcome}`);
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    console.error('[Mixam Webhook] Failed to apply update', (error as Error)?.message ?? error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
