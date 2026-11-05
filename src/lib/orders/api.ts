'use client';

/**
 * Calls to the print order routes (`/api/orders/**`, `/api/admin/orders/**`,
 * slice 5.5b). The browser never writes order documents.
 */
import { authFetch } from '@/lib/auth-fetch';

export class OrderApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'OrderApiError';
  }
}

async function send<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await authFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let payload: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new OrderApiError(payload?.error?.message || 'Something went wrong. Please try again.', payload?.error?.code || 'REQUEST_FAILED', response.status);
  }
  return payload.data as T;
}

const post = <T>(url: string, body?: unknown) => send<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export type OrderStatus =
  | 'rendering'
  | 'awaiting_payment'
  | 'paid'
  | 'awaiting_approval'
  | 'submitting'
  | 'submitted'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type OrderAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: 'GB';
};

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
  timeline: Array<{ status: OrderStatus; at: string; by: string; note: string | null }>;
  payment: { method: 'stripe' | 'credit' | 'admin' | null; paidAt: string | null; refundedAt: string | null };
  tracking: { jobNumber: string | null; trackingUrl: string | null };
  render: { status: 'rendering' | 'ready' | 'failed'; files: Array<{ role: string; url: string | null; pageCount: number | null }>; error: string | null } | null;
  actions: { canPay: boolean; canPayWithCredits: boolean; canCancel: boolean };
  creditsAvailable: number | null;
  createdAt: string | null;
};

export type AdminOrderView = OrderView & {
  ownerUid: string;
  renderId: string;
  approval: { required: boolean; approvedBy: string | null; approvedAt: string | null } | null;
  mixam: {
    orderId: string | null;
    jobNumber: string | null;
    status: string | null;
    trackingUrl: string | null;
    requestStartedAt: string | null;
    submittedAt: string | null;
    lastError: string | null;
  };
  paymentDetail: Record<string, unknown>;
  nextAction: 'approve' | 'retry' | 'none';
};

export type OrderSettings = { requireAdminApproval: boolean; notifyEmails: string[]; stripeMode: 'test' | 'live' | 'fake' | null };

export type CreateOrderRequest = {
  bookId: string;
  layoutId: string;
  quantity: number;
  shippingAddress: { name: string; line1: string; line2?: string | null; city: string; state?: string | null; postalCode: string };
  contactEmail?: string | null;
  idempotencyKey: string;
};

// Parent
export const createOrder = (request: CreateOrderRequest) => post<OrderView>('/api/orders', request);
export const listOrders = () => send<OrderView[]>('/api/orders');
export const getOrder = (orderId: string) => send<OrderView>(`/api/orders/${encodeURIComponent(orderId)}`);
export const startCheckout = (orderId: string) => post<{ url: string }>(`/api/orders/${encodeURIComponent(orderId)}/checkout`);
export const payWithCredits = (orderId: string) => post<OrderView>(`/api/orders/${encodeURIComponent(orderId)}/pay-with-credits`);
export const cancelOrder = (orderId: string) => post<OrderView>(`/api/orders/${encodeURIComponent(orderId)}/cancel`);

// Admin
export const listAdminOrders = (status?: OrderStatus | null) =>
  send<AdminOrderView[]>(`/api/admin/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`);
export const getAdminOrder = (orderId: string) => send<AdminOrderView>(`/api/admin/orders/${encodeURIComponent(orderId)}`);
export const approveOrder = (orderId: string) => post<AdminOrderView>(`/api/admin/orders/${encodeURIComponent(orderId)}/approve`);
export const adminCancelOrder = (orderId: string, note: string | null) => post<AdminOrderView>(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, { note });
export const markOrderPaid = (orderId: string, note: string) => post<AdminOrderView>(`/api/admin/orders/${encodeURIComponent(orderId)}/mark-paid`, { note });
export const retrySubmit = (orderId: string, force: boolean) => post<AdminOrderView>(`/api/admin/orders/${encodeURIComponent(orderId)}/retry`, { force });
export const refreshOrder = (orderId: string) => post<AdminOrderView>(`/api/admin/orders/${encodeURIComponent(orderId)}/refresh`);
export const getOrderSettings = () => send<OrderSettings>('/api/admin/orders/settings');
export const updateOrderSettings = (patch: Partial<Pick<OrderSettings, 'requireAdminApproval' | 'notifyEmails'>>) =>
  send<OrderSettings>('/api/admin/orders/settings', { method: 'PUT', body: JSON.stringify(patch) });

// Display helpers
export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amountMinor / 100);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  rendering: 'Preparing the print files',
  awaiting_payment: 'Waiting for payment',
  paid: 'Paid',
  awaiting_approval: 'Paid, being checked',
  submitting: 'Sending to the printer',
  submitted: 'With the printer',
  in_production: 'Being printed',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};
