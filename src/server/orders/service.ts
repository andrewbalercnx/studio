/**
 * Print orders (slice 5.5b): create, read, pay (Stripe Checkout or print
 * credits), cancel, the Stripe webhook, render-ready promotion, and the admin
 * actions. Every status change goes through `lifecycle.transition`; every
 * state change and the jobs it needs are written in one transaction; emails
 * and Stripe refunds happen after the commit.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { validateUKAddress } from '@/lib/mixam/address-validator';
import type { PrintOrderAddress } from '@/lib/types';
import { chargeAllowance, checkAllowance, readLedgerIn, returnConsumable } from '../books/allowance';
import type { ConfigService } from '../config/config-service';
import { ordersConfig } from '../config/definitions';
import { books, printOrders, renders, stripeEvents } from '../data/repositories';
import type { WithId } from '../data/repository';
import { addressSchema, type OrderAddress, type OrderStatus, type PrintOrderV2, type StatusEntry } from '../data/schemas/order';
import { BadRequestError, ConflictError, PaymentRequiredError, ServiceUnavailableError } from '../errors';
import { loadOwned, type VerifiedUser } from '../http';
import type { JobRunner, JobSpec } from '../jobs';
import { getRender, printOptions, startRender, type RenderView } from '../print/service';
import { approvalNeededEmail, paidEmail, shippedEmail, type SendEmail } from './emails';
import { submitSpec } from './jobs';
import { canTransition, isForwardFulfilment, mixamStatusToOrder, PARENT_CANCELLABLE, transition } from './lifecycle';
import type { MixamGateway } from './mixam';
import type { StripeEvent, StripeGateway } from './stripe';

export type OrderDeps = {
  db: Firestore;
  runner: Pick<JobRunner, 'enqueueInTransaction'>;
  stripe: () => Promise<StripeGateway | null>;
  mixam: () => Promise<MixamGateway>;
  sendEmail: SendEmail;
  config: Pick<ConfigService, 'get'>;
  now: () => Date;
  baseUrl: string;
};

const MAX_QUANTITY = 10;

function sha(text: string, length = 24): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

export function orderIdFor(ownerUid: string, idempotencyKey: string): string {
  return `po_${sha(`${ownerUid}|${idempotencyKey}`)}`;
}

/** Best effort: an email that fails is logged and the order goes on. */
async function sendAll(deps: OrderDeps, messages: Array<{ to: string; subject: string; html: string }>): Promise<void> {
  for (const message of messages) {
    try {
      await deps.sendEmail(message);
    } catch (error) {
      console.warn('[orders] Email failed', message.subject, (error as Error)?.message ?? error);
    }
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type OrderView = {
  id: string;
  bookId: string;
  layoutId: string;
  status: OrderStatus;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
  currency: string;
  shippingAddress: OrderAddress;
  contactEmail: string;
  timeline: StatusEntry[];
  payment: { method: PrintOrderV2['payment']['method']; paidAt: string | null; refundedAt: string | null };
  tracking: { jobNumber: string | null; trackingUrl: string | null };
  render: Pick<RenderView, 'status' | 'files' | 'error'> | null;
  /** Server-computed actions the client may offer. */
  actions: { canPay: boolean; canPayWithCredits: boolean; canCancel: boolean };
  /** Print credits the family could spend on this order (read views of one order only; else null). */
  creditsAvailable: number | null;
  createdAt: string | null;
};

export type AdminOrderView = OrderView & {
  ownerUid: string;
  renderId: string;
  approval: PrintOrderV2['approval'];
  mixam: PrintOrderV2['mixam'];
  paymentDetail: PrintOrderV2['payment'];
  /** What an admin should do next, if anything. */
  nextAction: 'approve' | 'retry' | 'none';
};

function iso(value: unknown): string | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString();
  return null;
}

function viewOf(order: WithId<PrintOrderV2>, render: RenderView | null, creditsAvailable: number | null = null): OrderView {
  return {
    id: order.id,
    bookId: order.bookId,
    layoutId: order.layoutId,
    status: order.status,
    quantity: order.quantity,
    unitAmountMinor: order.unitAmountMinor,
    amountMinor: order.amountMinor,
    currency: order.currency,
    shippingAddress: order.shippingAddress,
    contactEmail: order.contactEmail,
    timeline: order.statusHistory,
    payment: { method: order.payment.method, paidAt: order.payment.paidAt, refundedAt: order.payment.refundedAt },
    tracking: { jobNumber: order.mixam.jobNumber, trackingUrl: order.mixam.trackingUrl },
    render: render ? { status: render.status, files: render.files, error: render.error } : null,
    actions: {
      canPay: order.status === 'awaiting_payment',
      canPayWithCredits: order.status === 'awaiting_payment' && (creditsAvailable ?? 0) >= order.quantity,
      canCancel: PARENT_CANCELLABLE.has(order.status),
    },
    creditsAvailable,
    createdAt: iso(order.createdAt),
  };
}

function adminViewOf(order: WithId<PrintOrderV2>): AdminOrderView {
  const stuck = order.status === 'submitting' || (order.status === 'paid' && order.approval?.required === false && !!order.mixam.lastError);
  return {
    ...viewOf(order, null),
    ownerUid: order.ownerUid,
    renderId: order.renderId,
    approval: order.approval,
    mixam: order.mixam,
    paymentDetail: order.payment,
    nextAction: order.status === 'awaiting_approval' && !order.approval?.approvedAt ? 'approve' : stuck && order.mixam.lastError ? 'retry' : 'none',
  };
}

// ---------------------------------------------------------------------------
// Create, read
// ---------------------------------------------------------------------------

export type CreateOrderInput = {
  bookId: string;
  layoutId: string;
  quantity: number;
  shippingAddress: z_input_address;
  contactEmail?: string | null;
  idempotencyKey: string;
};
type z_input_address = Omit<OrderAddress, 'line2' | 'state' | 'country'> & { line2?: string | null; state?: string | null; country?: 'GB' };

/**
 * Create an order for a Book in its own template (the one the parent chose on
 * the Book page) once its print copies are ready: price from the catalogue, a
 * render for this order (which locks the Book), UK address checked. 409
 * LAYOUT_NOT_SET without a template, 409 LAYOUT_MISMATCH for another one,
 * 409 PRINT_NOT_READY while the pictures for print are being made (or failed).
 * The same key returns the same order.
 */
export async function createOrder(deps: OrderDeps, user: VerifiedUser, body: CreateOrderInput): Promise<OrderView> {
  const { db } = deps;
  const orderId = orderIdFor(user.uid, body.idempotencyKey);
  const existing = await printOrders.using(db).get(orderId);
  if (existing) return viewOf(existing, null);

  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > MAX_QUANTITY) {
    throw new BadRequestError(`Order between 1 and ${MAX_QUANTITY} copies`, { code: 'INVALID_QUANTITY' });
  }
  const address = addressSchema.parse(body.shippingAddress);
  const validation = validateUKAddress({ ...address, line2: address.line2 ?? undefined, state: address.state ?? undefined } as PrintOrderAddress);
  if (!validation.valid) {
    throw new BadRequestError(validation.errors[0] ?? 'Please check the address', { code: 'INVALID_ADDRESS', details: { errors: validation.errors } });
  }
  const contactEmail = (body.contactEmail || user.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) throw new BadRequestError('An email address is needed for the order', { code: 'INVALID_EMAIL' });

  const book = await loadOwned(user, books.using(db), body.bookId);
  if (!book.layoutId) throw new ConflictError('Choose a print template for this book first', { code: 'LAYOUT_NOT_SET' });
  if (book.layoutId !== body.layoutId) {
    throw new ConflictError("This book's pictures are drawn for another print template", { code: 'LAYOUT_MISMATCH', details: { layoutId: book.layoutId } });
  }
  if (book.print?.layoutId !== book.layoutId || book.print.status !== 'ready') {
    throw new ConflictError('The pictures for print are not ready yet', { code: 'PRINT_NOT_READY', details: { status: book.print?.status ?? null } });
  }
  const option = (await printOptions(db, user, body.bookId)).find((o) => o.layoutId === body.layoutId);
  if (!option) throw new ConflictError('This book cannot be printed in that format', { code: 'LAYOUT_UNSUPPORTED' });
  if (!option.price || !option.printProductId) throw new ConflictError('This format has no price yet', { code: 'NO_PRICE' });
  const price = option.price;
  const printProductId = option.printProductId;

  const render = await startRender({ db, runner: deps.runner }, user, body.bookId, { layoutId: body.layoutId, idempotencyKey: `order:${orderId}` });
  const now = deps.now();
  const status: OrderStatus = render.status === 'ready' ? 'awaiting_payment' : 'rendering';
  const repo = printOrders.using(db);
  await db.runTransaction(async (tx) => {
    if (await repo.getIn(tx, orderId)) return;
    await repo.createIn(
      tx,
      {
        ownerUid: book.ownerUid,
        schemaVersion: 2,
        bookId: book.id,
        childId: book.childId,
        renderId: render.renderId,
        layoutId: body.layoutId,
        printProductId,
        productId: price.productId,
        priceId: price.priceId,
        quantity: body.quantity,
        unitAmountMinor: price.amountMinor,
        amountMinor: price.amountMinor * body.quantity,
        currency: price.currency,
        shippingAddress: address,
        contactEmail,
        status,
        statusHistory: [{ status, at: now.toISOString(), by: user.uid, note: null }],
        idempotencyKey: body.idempotencyKey,
      },
      { id: orderId }
    );
  });
  await promoteIfRendered(deps, orderId);
  return getOrder(deps, user, orderId);
}

/** `rendering` → `awaiting_payment` once the pinned render exists (called by the render job and on read). */
export async function promoteIfRendered(deps: Pick<OrderDeps, 'db' | 'now'>, orderId: string): Promise<void> {
  const { db } = deps;
  const repo = printOrders.using(db);
  const order = await repo.get(orderId);
  if (!order || order.status !== 'rendering') return;
  if (!(await renders.using(db).of(order.bookId).get(order.renderId))) return;
  await db.runTransaction(async (tx) => {
    const current = await repo.requireIn(tx, orderId);
    if (current.status !== 'rendering') return;
    await repo.updateIn(tx, orderId, transition(current, 'awaiting_payment', 'system', deps.now(), 'Print files ready'));
  });
}

/** Orders waiting on this render move on (the render job calls this once its document exists). */
export async function promoteOrdersForRender(deps: Pick<OrderDeps, 'db' | 'now'>, renderId: string): Promise<void> {
  const waiting = await printOrders.using(deps.db).where({ renderId, status: 'rendering' });
  for (const order of waiting) await promoteIfRendered(deps, order.id);
}

async function loadOwnedOrder(deps: Pick<OrderDeps, 'db'>, user: VerifiedUser, orderId: string): Promise<WithId<PrintOrderV2>> {
  return loadOwned(user, printOrders.using(deps.db), orderId);
}

export async function getOrder(deps: OrderDeps, user: VerifiedUser, orderId: string): Promise<OrderView> {
  await loadOwnedOrder(deps, user, orderId);
  await promoteIfRendered(deps, orderId);
  const order = await printOrders.using(deps.db).require(orderId);
  const render = await getRender(deps.db, user, order.bookId, order.renderId).catch(() => null);
  const credits = order.status === 'awaiting_payment' ? (await checkAllowance(deps.db, 'print_credit', order.ownerUid, order.childId, deps.now())).remaining : null;
  return viewOf(order, render, credits);
}

/** The family's orders, newest first (server-sorted). */
export async function listOrders(deps: OrderDeps, user: VerifiedUser): Promise<OrderView[]> {
  const orders = await printOrders.using(deps.db).listByOwner(user.uid);
  return orders
    .filter((o) => o.schemaVersion === 2)
    .map((o) => viewOf(o, null))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

type PaidOutcome = { specs: JobSpec[]; emails: Array<{ to: string; subject: string; html: string }> };

/**
 * The writes for "this order is paid": `paid`, then `awaiting_approval` when
 * approval is on, else an `order.submit` job (enqueued in the same transaction).
 */
async function markPaidIn(
  tx: Transaction,
  deps: OrderDeps,
  order: WithId<PrintOrderV2>,
  payment: Partial<PrintOrderV2['payment']>,
  by: string,
  note: string | null
): Promise<PaidOutcome & { dispatch: () => Promise<void> }> {
  const now = deps.now();
  const config = await deps.config.get(ordersConfig);
  let moved = transition(order, 'paid', by, now, note);
  const paidPayment = { ...order.payment, ...payment, paidAt: now.toISOString() };
  const after: PrintOrderV2 = { ...order, ...moved, payment: paidPayment };
  const emails = [paidEmail(order.id, after, deps.baseUrl)];
  let specs: JobSpec[] = [];
  if (config.requireAdminApproval) {
    moved = transition(after, 'awaiting_approval', 'system', now);
    for (const to of config.notifyEmails) emails.push(approvalNeededEmail(to, order.id, after, deps.baseUrl));
  } else {
    specs = [submitSpec(order)];
  }
  const pending = specs.length ? await deps.runner.enqueueInTransaction(tx, specs) : { dispatch: async () => undefined };
  await printOrders.using(deps.db).updateIn(tx, order.id, {
    ...moved,
    payment: paidPayment,
    approval: { required: config.requireAdminApproval, approvedBy: null, approvedAt: null },
  });
  return { specs, emails, dispatch: pending.dispatch };
}

/** Start Stripe Checkout for an order awaiting payment; returns the URL to send the browser to. */
export async function checkout(deps: OrderDeps, user: VerifiedUser, orderId: string): Promise<{ url: string }> {
  await loadOwnedOrder(deps, user, orderId);
  await promoteIfRendered(deps, orderId);
  const order = await printOrders.using(deps.db).require(orderId);
  if (order.status !== 'awaiting_payment') {
    throw new ConflictError(order.status === 'rendering' ? 'The print files are still being made' : `This order is ${order.status.replace('_', ' ')}`, {
      code: order.status === 'rendering' ? 'ORDER_RENDERING' : 'ORDER_STATE',
    });
  }
  const stripe = await deps.stripe();
  if (!stripe) throw new ServiceUnavailableError('Card payments are not set up yet', { code: 'STRIPE_NOT_CONFIGURED' });
  const priceDoc = await deps.db.collection('prices').doc(order.priceId).get();
  const externalPriceId = typeof priceDoc.data()?.externalPriceId === 'string' ? (priceDoc.data()!.externalPriceId as string) : null;
  const productDoc = await deps.db.collection('products').doc(order.productId).get();
  const session = await stripe.createCheckoutSession({
    orderId,
    externalPriceId,
    unitAmountMinor: order.unitAmountMinor,
    quantity: order.quantity,
    currency: order.currency,
    productName: String(productDoc.data()?.name ?? 'Printed book'),
    customerEmail: order.contactEmail,
    successUrl: `${deps.baseUrl}/orders/${encodeURIComponent(orderId)}?paid=1`,
    cancelUrl: `${deps.baseUrl}/orders/${encodeURIComponent(orderId)}`,
    idempotencyKey: `checkout:${orderId}:${order.amountMinor}`,
  });
  await printOrders.using(deps.db).update(orderId, { payment: { ...order.payment, checkoutSessionId: session.id } });
  return { url: session.url };
}

/** Pay with print credits: one per copy, spent in the transaction that marks the order paid. */
export async function payWithCredits(deps: OrderDeps, user: VerifiedUser, orderId: string): Promise<OrderView> {
  await loadOwnedOrder(deps, user, orderId);
  await promoteIfRendered(deps, orderId);
  const repo = printOrders.using(deps.db);
  const outcome = await deps.db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.status !== 'awaiting_payment') {
      throw new ConflictError(order.status === 'rendering' ? 'The print files are still being made' : `This order is ${order.status.replace('_', ' ')}`, {
        code: order.status === 'rendering' ? 'ORDER_RENDERING' : 'ORDER_STATE',
      });
    }
    const ledger = await readLedgerIn(tx, deps.db, order.ownerUid);
    const charge = chargeAllowance(tx, ledger, 'print_credit', order.ownerUid, order.childId, deps.now(), order.quantity);
    if (!charge.allowed) {
      throw new PaymentRequiredError(`Not enough print credits (${charge.remaining} left, ${order.quantity} needed)`, {
        code: 'ENTITLEMENT_LIMIT',
        details: { component: 'print_credit', remaining: charge.remaining },
      });
    }
    const paid = await markPaidIn(tx, deps, order, { method: 'credit', credits: { quantity: order.quantity, source: charge.source, returned: false } }, user.uid, 'Paid with print credits');
    charge.write();
    return paid;
  });
  await outcome.dispatch();
  await sendAll(deps, outcome.emails);
  return getOrder(deps, user, orderId);
}

// ---------------------------------------------------------------------------
// Cancelling and refunds
// ---------------------------------------------------------------------------

/** The cancel writes; returns the Stripe payment to refund after the commit, if any. */
async function cancelIn(tx: Transaction, deps: OrderDeps, order: WithId<PrintOrderV2>, by: string, note: string | null): Promise<string | null> {
  const repo = printOrders.using(deps.db);
  const ledger = order.payment.credits && !order.payment.credits.returned ? await readLedgerIn(tx, deps.db, order.ownerUid) : null;
  const patch: Parameters<typeof repo.updateIn>[2] = transition(order, 'cancelled', by, deps.now(), note);
  if (ledger && order.payment.credits) {
    returnConsumable(tx, ledger, 'print_credit', order.payment.credits.source, order.childId, order.payment.credits.quantity);
    patch.payment = { ...order.payment, credits: { ...order.payment.credits, returned: true } };
  }
  await repo.updateIn(tx, order.id, patch);
  return order.payment.method === 'stripe' && order.payment.paymentIntentId && !order.payment.refundId ? order.payment.paymentIntentId : null;
}

async function refundAfterCommit(deps: OrderDeps, orderId: string, paymentIntentId: string | null): Promise<void> {
  if (!paymentIntentId) return;
  const stripe = await deps.stripe();
  if (!stripe) {
    console.error(`[orders] Order ${orderId} was cancelled but Stripe is not configured: refund it by hand`);
    return;
  }
  const refund = await stripe.refund(paymentIntentId, `refund:${orderId}`);
  const order = await printOrders.using(deps.db).require(orderId);
  await printOrders.using(deps.db).update(orderId, { payment: { ...order.payment, refundId: refund.id } });
}

/** A parent cancels before the order goes to the printer; card payments are refunded, credits returned. */
export async function cancelOrder(deps: OrderDeps, user: VerifiedUser, orderId: string): Promise<OrderView> {
  await loadOwnedOrder(deps, user, orderId);
  const repo = printOrders.using(deps.db);
  const refund = await deps.db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.status === 'cancelled') return null;
    if (!PARENT_CANCELLABLE.has(order.status)) {
      throw new ConflictError('This order has gone to the printer and can no longer be cancelled here', { code: 'ORDER_NOT_CANCELLABLE' });
    }
    return cancelIn(tx, deps, order, user.uid, 'Cancelled by the parent');
  });
  await refundAfterCommit(deps, orderId, refund);
  return getOrder(deps, user, orderId);
}

// ---------------------------------------------------------------------------
// Stripe webhook
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Apply one Stripe event, once (`stripeEvents/{eventId}` is written in the same
 * transaction). Throws on a bad signature (400) or when Stripe is not
 * configured (503); any other error is a 500, so Stripe retries.
 */
export async function handleStripeEvent(deps: OrderDeps, rawBody: string, signature: string | null): Promise<{ eventId: string; outcome: string }> {
  const stripe = await deps.stripe();
  if (!stripe) throw new ServiceUnavailableError('Stripe is not configured', { code: 'STRIPE_NOT_CONFIGURED' });
  let event: StripeEvent;
  try {
    event = stripe.constructEvent(rawBody, signature);
  } catch (error) {
    throw new BadRequestError('Invalid Stripe signature', { code: 'INVALID_SIGNATURE', cause: error });
  }
  const object = event.data?.object ?? {};
  const eventRepo = stripeEvents.using(deps.db);
  const repo = printOrders.using(deps.db);

  let orderId: string | null = null;
  if (event.type === 'checkout.session.completed') {
    orderId = str(object.client_reference_id) ?? str((object.metadata as Record<string, unknown> | undefined)?.orderId);
  } else if (event.type === 'charge.refunded') {
    const intent = str(object.payment_intent);
    if (intent) {
      const match = await deps.db.collection('printOrders').where('payment.paymentIntentId', '==', intent).limit(1).get();
      orderId = match.empty ? null : match.docs[0].id;
    }
  }

  const result = await deps.db.runTransaction(async (tx) => {
    if (await eventRepo.getIn(tx, event.id)) return { outcome: 'duplicate', after: null as null | (() => Promise<void>) };
    const order = orderId ? await repo.getIn(tx, orderId) : null;
    let outcome = 'ignored';
    let after: null | (() => Promise<void>) = null;

    if (event.type === 'checkout.session.completed' && order) {
      const paymentIntentId = str(object.payment_intent);
      if (object.payment_status !== 'paid') {
        outcome = 'unpaid';
      } else if (order.status === 'awaiting_payment') {
        const amount = typeof object.amount_total === 'number' ? object.amount_total : null;
        const note = amount !== null && amount !== order.amountMinor ? `Stripe charged ${amount}, order is ${order.amountMinor}` : null;
        const paid = await markPaidIn(tx, deps, order, { method: 'stripe', checkoutSessionId: str(object.id), paymentIntentId }, 'stripe', note);
        outcome = 'paid';
        after = async () => {
          await paid.dispatch();
          await sendAll(deps, paid.emails);
        };
      } else if (order.status === 'cancelled' && paymentIntentId && !order.payment.refundId) {
        // Paid after the parent cancelled: give the money back.
        await repo.updateIn(tx, order.id, { payment: { ...order.payment, method: 'stripe', paymentIntentId, checkoutSessionId: str(object.id) } });
        outcome = 'refund_after_cancel';
        after = () => refundAfterCommit(deps, order.id, paymentIntentId);
      } else {
        outcome = `ignored_${order.status}`;
      }
    } else if (event.type === 'charge.refunded' && order) {
      if (order.status !== 'refunded' && canTransition(order.status, 'refunded')) {
        await repo.updateIn(tx, order.id, {
          ...transition(order, 'refunded', 'stripe', deps.now()),
          payment: { ...order.payment, refundedAt: deps.now().toISOString() },
        });
        outcome = 'refunded';
      } else {
        outcome = `ignored_${order.status}`;
      }
    }
    await eventRepo.createIn(tx, { type: event.type, orderId: order?.id ?? orderId, outcome }, { id: event.id });
    return { outcome, after };
  });
  if (result.after) await result.after();
  return { eventId: event.id, outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// Mixam progress (webhook and admin refresh): forward only
// ---------------------------------------------------------------------------

export async function applyMixamStatus(
  deps: OrderDeps,
  orderId: string,
  report: { mixamOrderId: string | null; status: string; trackingUrl?: string | null }
): Promise<{ outcome: string }> {
  const repo = printOrders.using(deps.db);
  const result = await deps.db.runTransaction(async (tx) => {
    const order = await repo.getIn(tx, orderId);
    if (!order || order.schemaVersion !== 2) return { outcome: 'unknown_order', shipped: null as WithId<PrintOrderV2> | null };
    if (!order.mixam.orderId || (report.mixamOrderId && String(report.mixamOrderId) !== order.mixam.orderId)) {
      return { outcome: 'mixam_id_mismatch', shipped: null };
    }
    const mixam = { ...order.mixam, status: report.status, trackingUrl: report.trackingUrl ?? order.mixam.trackingUrl };
    const next = mixamStatusToOrder(report.status);
    if (!next || !isForwardFulfilment(order.status, next)) {
      await repo.updateIn(tx, orderId, { mixam });
      return { outcome: next ? 'not_forward' : 'status_recorded', shipped: null };
    }
    await repo.updateIn(tx, orderId, { ...transition(order, next, 'mixam', deps.now(), `Mixam: ${report.status}`), mixam });
    return { outcome: next, shipped: next === 'shipped' ? { ...order, mixam } : null };
  });
  if (result.shipped) await sendAll(deps, [shippedEmail(orderId, result.shipped, deps.baseUrl)]);
  return { outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listAdminOrders(deps: OrderDeps, filter: { status?: OrderStatus | null } = {}): Promise<AdminOrderView[]> {
  const orders = await printOrders.using(deps.db).where({ schemaVersion: 2, ...(filter.status ? { status: filter.status } : {}) });
  return orders.map(adminViewOf).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function getAdminOrder(deps: OrderDeps, orderId: string): Promise<AdminOrderView> {
  return adminViewOf(await printOrders.using(deps.db).require(orderId));
}

/** Approve a paid order waiting for approval: enqueue `order.submit`. */
export async function approveOrder(deps: OrderDeps, admin: VerifiedUser, orderId: string): Promise<AdminOrderView> {
  const repo = printOrders.using(deps.db);
  const pending = await deps.db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.status !== 'awaiting_approval') throw new ConflictError(`This order is ${order.status.replace('_', ' ')}`, { code: 'ORDER_STATE' });
    if (order.approval?.approvedAt) return null;
    const jobs = await deps.runner.enqueueInTransaction(tx, [submitSpec(order)]);
    await repo.updateIn(tx, orderId, {
      approval: { required: true, approvedBy: admin.uid, approvedAt: deps.now().toISOString() },
      statusHistory: [...order.statusHistory, { status: order.status, at: deps.now().toISOString(), by: admin.uid, note: 'Approved' }],
    });
    return jobs;
  });
  if (pending) await pending.dispatch();
  return getAdminOrder(deps, orderId);
}

/** Admin cancel: any order not yet shipped; cancels at Mixam first when it was submitted, then refunds. */
export async function adminCancelOrder(deps: OrderDeps, admin: VerifiedUser, orderId: string, note: string | null): Promise<AdminOrderView> {
  const repo = printOrders.using(deps.db);
  const current = await repo.require(orderId);
  if (!canTransition(current.status, 'cancelled')) throw new ConflictError(`An order that is ${current.status} cannot be cancelled`, { code: 'ORDER_STATE' });
  if (current.mixam.orderId) {
    try {
      await (await deps.mixam()).cancel(current.mixam.orderId);
    } catch (error) {
      throw new ConflictError(`Mixam would not cancel this order: ${(error as Error).message}`, { code: 'MIXAM_CANCEL_FAILED' });
    }
  }
  const refund = await deps.db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.status === 'cancelled') return null;
    return cancelIn(tx, deps, order, admin.uid, note ?? 'Cancelled by an admin');
  });
  await refundAfterCommit(deps, orderId, refund);
  return getAdminOrder(deps, orderId);
}

/** Audited mark-paid (e.g. paid by bank transfer): a note is required. */
export async function markOrderPaid(deps: OrderDeps, admin: VerifiedUser, orderId: string, note: string): Promise<AdminOrderView> {
  if (!note?.trim()) throw new BadRequestError('Say why the order is being marked paid', { code: 'NOTE_REQUIRED' });
  await promoteIfRendered(deps, orderId);
  const repo = printOrders.using(deps.db);
  const outcome = await deps.db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.status !== 'awaiting_payment') throw new ConflictError(`This order is ${order.status.replace('_', ' ')}`, { code: 'ORDER_STATE' });
    return markPaidIn(tx, deps, order, { method: 'admin', markedPaidBy: admin.uid, note: note.trim() }, admin.uid, `Marked paid: ${note.trim()}`);
  });
  await outcome.dispatch();
  await sendAll(deps, outcome.emails);
  return getAdminOrder(deps, orderId);
}

/**
 * Retry submission: a new `order.submit` job. `force` skips the Mixam lookup
 * after an uncertain attempt; only use it once the admin has checked Mixam.
 */
export async function retrySubmit(deps: OrderDeps, admin: VerifiedUser, orderId: string, force: boolean): Promise<AdminOrderView> {
  const repo = printOrders.using(deps.db);
  const pending = await deps.db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.mixam.orderId) throw new ConflictError('This order is already at Mixam', { code: 'ALREADY_SUBMITTED' });
    const ready =
      order.status === 'submitting' ||
      (order.status === 'paid' && order.approval?.required === false) ||
      (order.status === 'awaiting_approval' && !!order.approval?.approvedAt);
    if (!ready) throw new ConflictError(`This order is ${order.status.replace('_', ' ')}`, { code: 'ORDER_STATE' });
    const jobs = await deps.runner.enqueueInTransaction(tx, [submitSpec(order, `${deps.now().getTime()}`, force)]);
    await repo.updateIn(tx, orderId, {
      statusHistory: [...order.statusHistory, { status: order.status, at: deps.now().toISOString(), by: admin.uid, note: force ? 'Submit retried (forced)' : 'Submit retried' }],
    });
    return jobs;
  });
  await pending.dispatch();
  return getAdminOrder(deps, orderId);
}

/** Ask Mixam for the order's status and apply it (forward only). */
export async function refreshFromMixam(deps: OrderDeps, orderId: string): Promise<AdminOrderView> {
  const order = await printOrders.using(deps.db).require(orderId);
  if (!order.mixam.orderId) throw new ConflictError('This order has not reached Mixam', { code: 'NOT_SUBMITTED' });
  const status = await (await deps.mixam()).getStatus(order.mixam.orderId);
  await applyMixamStatus(deps, orderId, { mixamOrderId: order.mixam.orderId, status: status.status, trackingUrl: status.trackingUrl });
  return getAdminOrder(deps, orderId);
}


// ---------------------------------------------------------------------------
// Settings (admin): systemConfig/orders
// ---------------------------------------------------------------------------

export type OrderSettings = { requireAdminApproval: boolean; notifyEmails: string[]; stripeMode: 'test' | 'live' | 'fake' | null };

export async function getOrderSettings(deps: OrderDeps): Promise<OrderSettings> {
  const [config, stripe] = await Promise.all([deps.config.get(ordersConfig), deps.stripe()]);
  return { ...config, stripeMode: stripe?.mode ?? null };
}

export async function updateOrderSettings(deps: OrderDeps, patch: Partial<Pick<OrderSettings, 'requireAdminApproval' | 'notifyEmails'>>): Promise<OrderSettings> {
  const current = await deps.config.get(ordersConfig);
  const next = ordersConfig.schema.parse({ ...current, ...patch });
  await deps.db.doc(ordersConfig.path).set(next, { merge: true });
  const { invalidateConfig } = await import('../config/config-service');
  invalidateConfig(ordersConfig);
  return getOrderSettings(deps);
}
