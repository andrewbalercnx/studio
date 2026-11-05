import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import SampleLayouts from '@/data/print-layouts.json';
import type { PrintLayout } from '@/lib/types';
import { createBook } from '../../books/service';
import { createBench, seed, user, type Bench } from '../../books/__tests__/helpers';
import type { ConfigDefinition } from '../../config/config-service';
import { jobs, printOrders } from '../../data/repositories';
import type { OrderStatus } from '../../data/schemas/order';
import { canTransition, isForwardFulfilment, mixamStatusToOrder, transition } from '../lifecycle';
import {
  adminCancelOrder,
  applyMixamStatus,
  approveOrder,
  cancelOrder,
  checkout,
  createOrder,
  getOrder,
  handleStripeEvent,
  listAdminOrders,
  listOrders,
  markOrderPaid,
  payWithCredits,
  refreshFromMixam,
  retrySubmit,
  type OrderDeps,
} from '../service';
import { FakeStripeGateway, type StripeEvent } from '../stripe';

const p1 = { ...user('p1'), email: 'p1@test.local' };
const p2 = user('p2');
const admin = user('admin');
const address = { name: 'Ann Parent', line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA' };

let bench: Bench;
let stripe: FakeStripeGateway;
let deps: OrderDeps;
let sendEmail: ReturnType<typeof vi.fn>;
let ordersSettings: { requireAdminApproval: boolean; notifyEmails: string[] };

beforeEach(async () => {
  enforcePersonaScope.mockReset();
  enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  bench = createBench();
  await seed(bench.db);
  const { id: _id, ...layout } = (SampleLayouts as { printLayouts: PrintLayout[] }).printLayouts[0];
  await bench.db.collection('printLayouts').doc('spread').set({ ...layout, printProductId: 'hardcover', pageConstraints: { maxPages: 48, pageMultiple: 4 } });
  await bench.db.collection('printProducts').doc('hardcover').set({
    name: 'Hardcover',
    spine: true,
    mixamSpec: {
      product: 'books',
      subProduct: 'hardcover_poth',
      cover: { type: 'COVER', pages: 4, material: { type: 'silk', weight: 150, units: 'GSM', color: 'WHITE' }, chromaticity: { front: 'CMYK', back: 'CMYK' } },
      interior: { type: 'CONTENT', material: { type: 'silk', weight: 170, units: 'GSM', color: 'WHITE' }, chromaticity: { front: 'CMYK', back: 'CMYK' } },
      binding: { type: 'case', edge: 'LEFT_RIGHT' },
      format: { minPageCount: 24, maxPageCount: 48, pageCountIncrement: 4, allowedTrimSizes: [], orientation: 'PORTRAIT', bleedRequired: 3.175 },
      files: { separateCoverAndInterior: true, colorSpace: 'CMYK', minDPI: 300, maxFileSize: 100000000 },
    },
  });
  await bench.db.collection('products').doc('book-hardcover').set({ active: true, printProductId: 'hardcover', name: 'Hardcover book' });
  await bench.db.collection('prices').doc('gbp').set({ active: true, productId: 'book-hardcover', currency: 'GBP', amountMinor: 2499 });
  stripe = new FakeStripeGateway();
  sendEmail = vi.fn(async () => undefined);
  ordersSettings = { requireAdminApproval: true, notifyEmails: ['ops@storypic.test'] };
  deps = {
    db: bench.db,
    runner: bench.runner,
    stripe: async () => stripe,
    mixam: async () => bench.mixam,
    sendEmail: sendEmail as unknown as OrderDeps['sendEmail'],
    config: {
      get: (async (definition: ConfigDefinition) =>
        definition.path === 'systemConfig/orders' ? ordersSettings : definition.defaults) as OrderDeps['config']['get'],
    },
    now: () => new Date('2026-11-05T10:00:00Z'),
    baseUrl: 'https://app.test',
  };
});

async function readyBook(): Promise<string> {
  const { bookId } = await createBook(bench.services, p1, { storyId: 's1', formId: 'picture', styleId: 'water' });
  await bench.drain();
  return bookId;
}

async function payableOrder(quantity = 1, key = 'order-key-1') {
  const bookId = await readyBook();
  const created = await createOrder(deps, p1, { bookId, layoutId: 'spread', quantity, shippingAddress: address, idempotencyKey: key });
  await bench.drain(); // the render
  return { bookId, orderId: created.id };
}

async function payByCard(orderId: string): Promise<StripeEvent> {
  await checkout(deps, p1, orderId);
  const session = [...stripe.sessions.entries()].find(([, s]) => s.orderId === orderId)![0];
  const event = stripe.completedEvent(session);
  await handleStripeEvent(deps, JSON.stringify(event), 'fake');
  return event;
}

async function status(orderId: string): Promise<OrderStatus> {
  return (await printOrders.using(bench.db).require(orderId)).status;
}

async function credits(): Promise<number> {
  const ledger = await bench.db.collection('entitlementLedgers').doc('p1').get();
  return (ledger.data()?.family?.print_credit?.balance as number | undefined) ?? 0;
}

describe('order lifecycle rules', () => {
  it('allows only the planned moves and records each in the history', () => {
    expect(canTransition('awaiting_payment', 'paid')).toBe(true);
    expect(canTransition('awaiting_payment', 'submitting')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'refunded')).toBe(true);
    const moved = transition({ status: 'paid', statusHistory: [] }, 'awaiting_approval', 'system', new Date('2026-11-05T00:00:00Z'));
    expect(moved.statusHistory).toEqual([{ status: 'awaiting_approval', at: '2026-11-05T00:00:00.000Z', by: 'system', note: null }]);
    expect(() => transition({ status: 'shipped', statusHistory: [] }, 'cancelled', 'x', new Date())).toThrow(/cannot become/);
  });

  it('maps Mixam statuses and only moves forward', () => {
    expect(mixamStatusToOrder('INPRODUCTION')).toBe('in_production');
    expect(mixamStatusToOrder('DISPATCHED')).toBe('shipped');
    expect(mixamStatusToOrder('ONHOLD')).toBeNull();
    expect(isForwardFulfilment('submitted', 'shipped')).toBe(true);
    expect(isForwardFulfilment('shipped', 'in_production')).toBe(false);
  });
});

describe('creating an order', () => {
  it('prices the order, renders it, and waits for payment once the files exist', async () => {
    const bookId = await readyBook();
    const created = await createOrder(deps, p1, { bookId, layoutId: 'spread', quantity: 2, shippingAddress: address, idempotencyKey: 'order-key-1' });
    expect(created).toMatchObject({ status: 'rendering', quantity: 2, unitAmountMinor: 2499, amountMinor: 4998, currency: 'GBP', contactEmail: 'p1@test.local' });
    expect(created.actions).toEqual({ canPay: false, canCancel: true });
    await bench.drain();
    const view = await getOrder(deps, p1, created.id);
    expect(view.status).toBe('awaiting_payment');
    expect(view.render?.status).toBe('ready');
    expect(view.timeline.map((t) => t.status)).toEqual(['rendering', 'awaiting_payment']);
    // Same key → same order.
    const again = await createOrder(deps, p1, { bookId, layoutId: 'spread', quantity: 2, shippingAddress: address, idempotencyKey: 'order-key-1' });
    expect(again.id).toBe(created.id);
    expect(await listOrders(deps, p1)).toHaveLength(1);
    await expect(getOrder(deps, p2, created.id)).rejects.toThrow();
  });

  it('refuses a bad address, a template without a price, and too many copies', async () => {
    const bookId = await readyBook();
    await expect(
      createOrder(deps, p1, { bookId, layoutId: 'spread', quantity: 1, shippingAddress: { ...address, postalCode: 'NOPE' }, idempotencyKey: 'order-key-2' })
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    await expect(createOrder(deps, p1, { bookId, layoutId: 'square', quantity: 1, shippingAddress: address, idempotencyKey: 'order-key-3' })).rejects.toMatchObject({
      code: 'NO_PRICE',
    });
    await expect(createOrder(deps, p1, { bookId, layoutId: 'spread', quantity: 11, shippingAddress: address, idempotencyKey: 'order-key-4' })).rejects.toMatchObject({
      code: 'INVALID_QUANTITY',
    });
  });
});

describe('paying by card (Stripe)', () => {
  it('waits for approval when the switch is on, applies each event once, then submits on approval', async () => {
    const { orderId } = await payableOrder();
    const { url } = await checkout(deps, p1, orderId);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const session = [...stripe.sessions.values()][0];
    expect(session).toMatchObject({ orderId, unitAmountMinor: 2499, quantity: 1, currency: 'GBP', successUrl: `https://app.test/orders/${orderId}?paid=1` });

    const event = stripe.completedEvent([...stripe.sessions.keys()][0]);
    expect(await handleStripeEvent(deps, JSON.stringify(event), 'fake')).toMatchObject({ outcome: 'paid' });
    expect(await status(orderId)).toBe('awaiting_approval');
    expect(sendEmail.mock.calls.map(([m]) => m.to)).toEqual(['p1@test.local', 'ops@storypic.test']);

    // The same event again changes nothing.
    expect(await handleStripeEvent(deps, JSON.stringify(event), 'fake')).toMatchObject({ outcome: 'duplicate' });
    const order = await printOrders.using(bench.db).require(orderId);
    expect(order.statusHistory.map((s) => s.status)).toEqual(['rendering', 'awaiting_payment', 'paid', 'awaiting_approval']);
    expect(order.payment).toMatchObject({ method: 'stripe', paymentIntentId: expect.stringMatching(/^pi_fake_/) });

    // Nothing goes to Mixam until an admin approves.
    await bench.drain();
    expect(bench.mixam.submitted).toHaveLength(0);
    expect((await listAdminOrders(deps, { status: 'awaiting_approval' }))[0]).toMatchObject({ id: orderId, nextAction: 'approve' });
    await approveOrder(deps, admin, orderId);
    await bench.drain();
    expect(await status(orderId)).toBe('submitted');
    expect(bench.mixam.submitted).toHaveLength(1);
    expect(bench.mixam.submitted[0].metadata.externalOrderId).toBe(orderId);
  });

  it('submits straight away when approval is off', async () => {
    ordersSettings.requireAdminApproval = false;
    const { orderId } = await payableOrder();
    await payByCard(orderId);
    expect(await status(orderId)).toBe('paid');
    await bench.drain();
    expect(await status(orderId)).toBe('submitted');
  });

  it('rejects a bad signature and answers 503 without Stripe', async () => {
    await expect(handleStripeEvent(deps, '{}', 'wrong')).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    await expect(handleStripeEvent({ ...deps, stripe: async () => null }, '{}', 'fake')).rejects.toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' });
    const { orderId } = await payableOrder();
    await expect(checkout({ ...deps, stripe: async () => null }, p1, orderId)).rejects.toMatchObject({ code: 'STRIPE_NOT_CONFIGURED' });
  });

  it('refunds a card order the parent cancels, and records the refund from the webhook', async () => {
    const { orderId } = await payableOrder();
    await payByCard(orderId);
    const view = await cancelOrder(deps, p1, orderId);
    expect(view.status).toBe('cancelled');
    expect(stripe.refunds).toHaveLength(1);
    const intent = stripe.refunds[0].paymentIntentId;
    await handleStripeEvent(deps, JSON.stringify(stripe.refundedEvent(intent)), 'fake');
    expect(await status(orderId)).toBe('refunded');
  });
});

describe('paying with print credits', () => {
  it('spends one credit per copy in the paying transaction and returns them on cancel', async () => {
    const { orderId } = await payableOrder(2);
    await expect(payWithCredits(deps, p1, orderId)).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT' });
    expect(await status(orderId)).toBe('awaiting_payment');

    await bench.db.collection('entitlementLedgers').doc('p1').set({ family: { print_credit: { granted: 3, consumed: 0, balance: 3 } } }, { merge: true });
    const paid = await payWithCredits(deps, p1, orderId);
    expect(paid.status).toBe('awaiting_approval');
    expect(await credits()).toBe(1);
    expect((await printOrders.using(bench.db).require(orderId)).payment).toMatchObject({ method: 'credit', credits: { quantity: 2, source: 'family', returned: false } });

    await cancelOrder(deps, p1, orderId);
    expect(await credits()).toBe(3);
    expect(stripe.refunds).toHaveLength(0);
    // Cancelling twice gives nothing back twice.
    await cancelOrder(deps, p1, orderId);
    expect(await credits()).toBe(3);
  });
});

describe('submitting to Mixam', () => {
  beforeEach(() => {
    ordersSettings.requireAdminApproval = false;
  });

  it('never submits twice when the answer is lost: the retry finds the order at Mixam', async () => {
    const { orderId } = await payableOrder();
    bench.mixam.failNext = 'lost-response';
    await payByCard(orderId);
    await bench.drain();
    expect(bench.mixam.submitted).toHaveLength(1);
    const order = await printOrders.using(bench.db).require(orderId);
    expect(order).toMatchObject({ status: 'submitted', mixam: { orderId: 'mx_1', jobNumber: '1001' } });
  });

  it('stops when a lost answer cannot be checked, until an admin forces a retry', async () => {
    const { orderId } = await payableOrder();
    bench.mixam.failNext = 'lost-response';
    bench.mixam.supportsLookup = false;
    await payByCard(orderId);
    await bench.drain();
    expect(bench.mixam.submitted).toHaveLength(1);
    const stuck = await printOrders.using(bench.db).require(orderId);
    expect(stuck.status).toBe('submitting');
    expect(stuck.mixam.lastError).toMatch(/could not be found/);
    const submitJobs = await jobs.using(bench.db).where({ kind: 'order.submit' });
    expect(submitJobs[0]).toMatchObject({ status: 'failed', error: { code: 'SUBMIT_UNCERTAIN' } });
    expect((await listAdminOrders(deps))[0].nextAction).toBe('retry');

    await retrySubmit(deps, admin, orderId, true);
    await bench.drain();
    expect(await status(orderId)).toBe('submitted');
  });

  it('records a Mixam refusal without retrying, and resubmits on an admin retry', async () => {
    const { orderId } = await payableOrder();
    bench.mixam.failNext = 'rejected';
    await payByCard(orderId);
    await bench.drain();
    const refused = await printOrders.using(bench.db).require(orderId);
    expect(refused).toMatchObject({ status: 'submitting', mixam: { requestStartedAt: null, lastError: expect.stringContaining('400') } });
    expect(bench.mixam.submitted).toHaveLength(0);
    await retrySubmit(deps, admin, orderId, false);
    await bench.drain();
    expect(await status(orderId)).toBe('submitted');
    await expect(retrySubmit(deps, admin, orderId, false)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
  });

  it('moves forward only on Mixam updates and emails on shipping', async () => {
    const { orderId } = await payableOrder();
    await payByCard(orderId);
    await bench.drain();
    sendEmail.mockClear();
    expect(await applyMixamStatus(deps, orderId, { mixamOrderId: 'mx_1', status: 'INPRODUCTION' })).toEqual({ outcome: 'in_production' });
    expect(await applyMixamStatus(deps, orderId, { mixamOrderId: 'mx_other', status: 'DISPATCHED' })).toEqual({ outcome: 'mixam_id_mismatch' });
    bench.mixam.statuses.set('mx_1', 'DISPATCHED');
    await refreshFromMixam(deps, orderId);
    expect(await status(orderId)).toBe('shipped');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p1@test.local', subject: expect.stringMatching(/on its way/) }));
    expect(await applyMixamStatus(deps, orderId, { mixamOrderId: 'mx_1', status: 'INPRODUCTION' })).toEqual({ outcome: 'not_forward' });
    expect(await applyMixamStatus(deps, orderId, { mixamOrderId: 'mx_1', status: 'ONHOLD' })).toEqual({ outcome: 'status_recorded' });
    expect(await status(orderId)).toBe('shipped');
    await expect(cancelOrder(deps, p1, orderId)).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
  });
});

describe('admin actions', () => {
  it('marks an order paid only with a note, and cancels a submitted order at Mixam first', async () => {
    ordersSettings.requireAdminApproval = false;
    const { orderId } = await payableOrder();
    await expect(markOrderPaid(deps, admin, orderId, ' ')).rejects.toMatchObject({ code: 'NOTE_REQUIRED' });
    const paid = await markOrderPaid(deps, admin, orderId, 'Bank transfer 123');
    expect(paid.paymentDetail).toMatchObject({ method: 'admin', markedPaidBy: 'admin', note: 'Bank transfer 123' });
    await bench.drain();
    expect(await status(orderId)).toBe('submitted');
    const cancelled = await adminCancelOrder(deps, admin, orderId, 'Customer called');
    expect(cancelled.status).toBe('cancelled');
    expect(bench.mixam.cancelled).toEqual(['mx_1']);
  });
});
