/**
 * Print orders and payment (slice 5.5b).
 * See docs/architecture/target/slices/5.5-print-orders.md.
 */
import { getDb } from '../data/db';
import { getJobRunner } from '../jobs';
import type { SubmitJobDeps } from './jobs';
import type { OrderDeps } from './service';
import { createStripeGateway, FakeStripeGateway, type StripeGateway } from './stripe';

export * from './service';
export { registerOrderJobs, SUBMIT_JOB_KIND, submitSpec } from './jobs';
export { FakeStripeGateway, stripeModeFromKey, type StripeGateway } from './stripe';

let stripeGateway: Promise<StripeGateway | null> | null = null;
const fakeStripe = new FakeStripeGateway();

/**
 * Stripe from `STRIPE_SECRET_KEY`; in TEST_MODE without a key, the fake (so the
 * emulator E2E runs without Stripe). Null when neither: card payment answers 503.
 */
async function stripe(): Promise<StripeGateway | null> {
  if (!stripeGateway) stripeGateway = createStripeGateway();
  const real = await stripeGateway;
  if (real) return real;
  const { isTestMode } = await import('@/lib/test-mode');
  return isTestMode() ? fakeStripe : null;
}

async function mixam() {
  const { createMixamGateway } = await import('./mixam');
  return createMixamGateway();
}

export async function getOrderDeps(): Promise<OrderDeps> {
  const [{ configService }, { sendEmail }, { appBaseUrl }] = await Promise.all([
    import('../config/config-service'),
    import('@/lib/email/send-email'),
    import('../auth-email/password-reset'),
  ]);
  return {
    db: await getDb(),
    runner: getJobRunner(),
    stripe,
    mixam,
    sendEmail: (message) => sendEmail(message),
    config: configService,
    now: () => new Date(),
    baseUrl: appBaseUrl(),
  };
}

export async function defaultSubmitJobDeps(): Promise<SubmitJobDeps> {
  return { mixam, now: () => new Date() };
}
