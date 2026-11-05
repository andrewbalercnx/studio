/**
 * `order.submit` (queue `mixam`): hand a paid order to Mixam, never twice
 * (slice 5.5b).
 *
 * 1. Claim `submitting` in a transaction, only from `paid` (approval off) or
 *    an approved `awaiting_approval`. An order that already has a Mixam id is done.
 * 2. Mark `mixam.requestStartedAt` just before the request. A later attempt
 *    that finds it set (the request may have reached Mixam) looks the order up
 *    at Mixam by our id first; if it cannot be found, the job stops with
 *    SUBMIT_UNCERTAIN for an admin to check and force a retry.
 * 3. Submit and record the Mixam id → `submitted`. A 4xx answer (Mixam created
 *    nothing) clears the mark and fails without retrying, for an admin to fix.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { PrintProduct } from '@/lib/types';
import { printOrders, renders } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { PrintOrderV2 } from '../data/schemas/order';
import { JobFailure, type JobContext, type JobDefinition, type JobRegistry, type JobSpec } from '../jobs/registry';
import { transition } from './lifecycle';
import { buildOrderDocument, loadMixamSettings, MixamRejectedError, type MixamGateway, type MixamOrderRef } from './mixam';

export const SUBMIT_JOB_KIND = 'order.submit';

export type SubmitJobDeps = { mixam: () => Promise<MixamGateway>; now: () => Date };

export type SubmitJobInput = { orderId: string; force?: boolean };

/** `nonce` makes an admin retry a new job (the first one is terminal). */
export function submitSpec(order: { id: string; ownerUid: string }, nonce: string | null = null, force = false): JobSpec {
  return {
    kind: SUBMIT_JOB_KIND,
    ownerUid: order.ownerUid,
    target: { collection: 'printOrders', id: order.id },
    input: { orderId: order.id, ...(force ? { force: true } : {}) },
    idempotencyKey: nonce ? `${SUBMIT_JOB_KIND}:${order.id}:${nonce}` : `${SUBMIT_JOB_KIND}:${order.id}`,
  };
}

function submittable(order: PrintOrderV2): boolean {
  if (order.status === 'submitting') return true;
  if (order.status === 'paid') return order.approval?.required === false;
  if (order.status === 'awaiting_approval') return !!order.approval?.approvedAt;
  return false;
}

async function recordSubmitted(db: Firestore, orderId: string, ref: MixamOrderRef, now: Date): Promise<void> {
  const repo = printOrders.using(db);
  await db.runTransaction(async (tx) => {
    const order = await repo.requireIn(tx, orderId);
    if (order.mixam.orderId) return;
    await repo.updateIn(tx, orderId, {
      ...transition(order, 'submitted', 'mixam', now, `Mixam order ${ref.jobNumber || ref.orderId}`),
      mixam: { ...order.mixam, orderId: ref.orderId, jobNumber: ref.jobNumber || null, status: ref.status, submittedAt: now.toISOString(), lastError: null },
    });
  });
}

async function noteError(db: Firestore, orderId: string, message: string, clearRequest: boolean): Promise<void> {
  const repo = printOrders.using(db);
  const order = await repo.get(orderId);
  if (!order) return;
  await repo.update(orderId, { mixam: { ...order.mixam, lastError: message.slice(0, 500), ...(clearRequest ? { requestStartedAt: null } : {}) } });
}

function submitHandler(getDeps: () => Promise<SubmitJobDeps>): JobDefinition['run'] {
  return async (ctx: JobContext) => {
    const { db, job } = ctx;
    const { orderId, force = false } = job.input as SubmitJobInput;
    const deps = await getDeps();
    const repo = printOrders.using(db);

    // 1. Claim.
    const claim = await db.runTransaction(async (tx): Promise<{ done: true } | { done: false; order: WithId<PrintOrderV2>; lookup: boolean }> => {
      const order = await repo.requireIn(tx, orderId);
      if (order.mixam.orderId) return { done: true };
      if (!submittable(order)) {
        throw new JobFailure('ORDER_NOT_SUBMITTABLE', `Order is ${order.status}`, { retryable: false });
      }
      const lookup = order.status === 'submitting' && !!order.mixam.requestStartedAt && !force;
      if (order.status !== 'submitting') {
        await repo.updateIn(tx, orderId, transition(order, 'submitting', 'system', deps.now()));
      }
      return { done: false, order, lookup };
    });
    if (claim.done) return;

    const mixam = await deps.mixam();

    // 2. A previous attempt may have reached Mixam: find it there before sending again.
    if (claim.lookup) {
      const found = await mixam.findByExternalId(orderId);
      if (found) {
        await recordSubmitted(db, orderId, found, deps.now());
        return;
      }
      const message = 'A previous attempt may have reached Mixam and the order could not be found there. Check Mixam, then retry with force.';
      await noteError(db, orderId, message, false);
      throw new JobFailure('SUBMIT_UNCERTAIN', message, { retryable: false });
    }

    // 3. Build the order document from the pinned render.
    const order = claim.order;
    const render = await renders.using(db).of(order.bookId).get(order.renderId);
    if (!render) throw new JobFailure('RENDER_MISSING', `Render ${order.renderId} not found`, { retryable: false });
    const productSnapshot = await db.collection('printProducts').doc(order.printProductId).get();
    if (!productSnapshot.exists) throw new JobFailure('PRODUCT_MISSING', `Print product ${order.printProductId} not found`, { retryable: false });
    const product = { id: productSnapshot.id, ...productSnapshot.data() } as PrintProduct;
    const settings = await loadMixamSettings(db, order.contactEmail);
    let document;
    try {
      document = await buildOrderDocument({ orderId, order, render, product, billing: settings.billing, paymentMethod: settings.paymentMethod });
    } catch (error) {
      await noteError(db, orderId, (error as Error).message, true);
      throw new JobFailure('ORDER_DOCUMENT_INVALID', (error as Error).message, { retryable: false, cause: error });
    }

    await repo.update(orderId, { mixam: { ...order.mixam, requestStartedAt: deps.now().toISOString(), lastError: null } });
    let ref: MixamOrderRef;
    try {
      ref = await mixam.submit(document);
    } catch (error) {
      if (error instanceof MixamRejectedError) {
        await noteError(db, orderId, error.message, true);
        throw new JobFailure('MIXAM_REJECTED', error.message, { retryable: false, cause: error });
      }
      // Unknown outcome: keep the mark so the next attempt looks the order up first.
      await noteError(db, orderId, (error as Error)?.message ?? String(error), false);
      throw error;
    }
    await recordSubmitted(db, orderId, ref, deps.now());
  };
}

export function registerOrderJobs(registry: JobRegistry, getDeps: () => Promise<SubmitJobDeps>): JobRegistry {
  return registry.register({ kind: SUBMIT_JOB_KIND, queue: 'mixam', maxAttempts: 3, run: submitHandler(getDeps) });
}
