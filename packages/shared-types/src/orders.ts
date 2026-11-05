// ============================================================================
// Print orders (slices 5.5b, 5.6): /api/orders/**, /api/admin/orders/**
// ============================================================================

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
