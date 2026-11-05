/**
 * Mixam behind a small interface for orders (slice 5.5b), so the submit job
 * and admin actions are tested without the network. The real gateway wraps
 * `src/lib/mixam/client.ts` (which honours MIXAM_MOCK_MODE) and builds the
 * order document with `mxjdf-builder` from the pinned render.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { MxJdfDocument, MixamPaymentMethod } from '@/lib/mixam/mxjdf-builder';
import type { PrintableAssetMetadata, PrintOrder, PrintProduct } from '@/lib/types';
import type { Render } from '../data/schemas/book';
import type { PrintOrderV2 } from '../data/schemas/order';

export type MixamOrderRef = { orderId: string; jobNumber: string; status: string };

/** Mixam answered and refused (4xx): nothing was created, a corrected retry is safe. */
export class MixamRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MixamRejectedError';
  }
}

export interface MixamGateway {
  submit(document: MxJdfDocument): Promise<MixamOrderRef>;
  /** The order Mixam holds for our order id, or null when it cannot be found (or the lookup is unsupported). */
  findByExternalId(orderId: string): Promise<MixamOrderRef | null>;
  getStatus(mixamOrderId: string): Promise<{ status: string; trackingUrl: string | null }>;
  cancel(mixamOrderId: string): Promise<void>;
}

export type MixamBilling = NonNullable<Parameters<typeof import('@/lib/mixam/mxjdf-builder').buildMxJdfDocument>[0]['billingAddress']>;

/** The legacy shapes `buildMxJdfDocument` reads, built from a v2 order and its render. */
export function legacyOrderShape(orderId: string, order: PrintOrderV2, product: PrintProduct): PrintOrder {
  return {
    id: orderId,
    contactEmail: order.contactEmail,
    quantity: order.quantity,
    shippingAddress: {
      name: order.shippingAddress.name,
      line1: order.shippingAddress.line1,
      line2: order.shippingAddress.line2 ?? undefined,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state ?? undefined,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
    },
    productSnapshot: product,
  } as unknown as PrintOrder;
}

export function renderMetadata(render: Render): PrintableAssetMetadata {
  const interior = render.files.find((f) => f.role === 'interior');
  const cover = render.files.find((f) => f.role === 'cover');
  return {
    dpi: 300,
    trimSize: render.trim ? `${render.trim.widthIn}in x ${render.trim.heightIn}in` : '',
    pageCount: (render.interiorPages ?? 0) + (cover?.pageCount ?? 0),
    coverPageCount: cover?.pageCount ?? 2,
    interiorPageCount: render.interiorPages ?? interior?.pageCount ?? 0,
    spreadCount: 0,
    printLayoutId: render.layoutId,
    paddingPageCount: 0,
  } as PrintableAssetMetadata;
}

export async function buildOrderDocument(input: {
  orderId: string;
  order: PrintOrderV2;
  render: Render;
  product: PrintProduct;
  billing: MixamBilling | undefined;
  paymentMethod: MixamPaymentMethod;
}): Promise<MxJdfDocument> {
  const { buildMxJdfDocument, validateMxJdfDocument } = await import('@/lib/mixam/mxjdf-builder');
  const cover = input.render.files.find((f) => f.role === 'cover')?.url;
  const interior = input.render.files.find((f) => f.role === 'interior')?.url;
  if (!cover || !interior) throw new Error('The render has no cover or interior PDF URL');
  const document = buildMxJdfDocument({
    order: legacyOrderShape(input.orderId, input.order, input.product),
    metadata: renderMetadata(input.render),
    coverFileRef: cover,
    interiorFileRef: interior,
    billingAddress: input.billing,
    paymentMethod: input.paymentMethod,
  });
  const check = validateMxJdfDocument(document);
  if (!check.valid) throw new Error(`Invalid Mixam order document: ${check.errors.join('; ')}`);
  return document;
}

/** Mixam settings: payment method (`systemConfig/mixam`) and the bill-to address (`systemConfig/addresses`). */
export async function loadMixamSettings(db: Firestore, contactEmail: string): Promise<{ paymentMethod: MixamPaymentMethod; billing: MixamBilling | undefined }> {
  const { DEFAULT_MIXAM_CONFIG } = await import('@/lib/types');
  const [mixamDoc, addressDoc] = await Promise.all([db.collection('systemConfig').doc('mixam').get(), db.collection('systemConfig').doc('addresses').get()]);
  const paymentMethod = (mixamDoc.data()?.paymentMethod as MixamPaymentMethod | undefined) ?? DEFAULT_MIXAM_CONFIG.paymentMethod;
  const config = addressDoc.data() as { mixamBillToAddressId?: string; addresses?: Array<Record<string, string>> } | undefined;
  const billTo = config?.mixamBillToAddressId ? config.addresses?.find((a) => a.id === config.mixamBillToAddressId) : undefined;
  const billing = billTo
    ? {
        name: billTo.name,
        line1: billTo.line1,
        line2: billTo.line2,
        city: billTo.city,
        state: billTo.state,
        postalCode: billTo.postalCode,
        country: billTo.country || 'GB',
        email: contactEmail,
      }
    : undefined;
  return { paymentMethod, billing };
}

/** The real gateway over `mixamClient`. */
export async function createMixamGateway(): Promise<MixamGateway> {
  const { mixamClient } = await import('@/lib/mixam/client');
  return {
    async submit(document) {
      try {
        const result = await mixamClient.submitOrder(document);
        return { orderId: String(result.orderId), jobNumber: String(result.jobNumber ?? ''), status: String(result.status ?? '') };
      } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        // "Order submission failed: 4xx - …": Mixam answered and created nothing.
        if (/submission failed: 4\d\d/.test(message)) throw new MixamRejectedError(message);
        throw error;
      }
    },
    findByExternalId: (orderId) => mixamClient.findOrderByExternalId(orderId),
    async getStatus(mixamOrderId) {
      const status = await mixamClient.getOrderStatus(mixamOrderId);
      return { status: status.status, trackingUrl: status.trackingUrl ?? null };
    },
    async cancel(mixamOrderId) {
      await mixamClient.cancelOrder(mixamOrderId);
    },
  };
}

/** In-memory Mixam for tests. `failNext` makes the next submit throw (`rejected` = a 4xx answer). */
export class FakeMixamGateway implements MixamGateway {
  readonly submitted: MxJdfDocument[] = [];
  readonly cancelled: string[] = [];
  statuses = new Map<string, string>();
  failNext: null | 'network' | 'rejected' | 'lost-response' = null;
  supportsLookup = true;

  async submit(document: MxJdfDocument): Promise<MixamOrderRef> {
    const failure = this.failNext;
    this.failNext = null;
    if (failure === 'rejected') throw new MixamRejectedError('Order submission failed: 400 - bad document');
    if (failure === 'network') throw new Error('Network error calling Mixam API');
    this.submitted.push(document);
    const ref = { orderId: `mx_${this.submitted.length}`, jobNumber: String(1000 + this.submitted.length), status: 'PENDING' };
    this.statuses.set(ref.orderId, 'PENDING');
    // Mixam created the order but the answer never arrived.
    if (failure === 'lost-response') throw new Error('socket hang up');
    return ref;
  }

  async findByExternalId(orderId: string): Promise<MixamOrderRef | null> {
    if (!this.supportsLookup) return null;
    const index = this.submitted.findIndex((d) => d.metadata.externalOrderId === orderId);
    return index < 0 ? null : { orderId: `mx_${index + 1}`, jobNumber: String(1001 + index), status: this.statuses.get(`mx_${index + 1}`) ?? 'PENDING' };
  }

  async getStatus(mixamOrderId: string) {
    return { status: this.statuses.get(mixamOrderId) ?? 'PENDING', trackingUrl: this.statuses.get(mixamOrderId) === 'DISPATCHED' ? 'https://track.test/1' : null };
  }

  async cancel(mixamOrderId: string) {
    this.cancelled.push(mixamOrderId);
  }
}
