import type { PrintOrder } from '@/lib/types';

/**
 * Get the base URL for admin links.
 * Uses NEXT_PUBLIC_SITE_URL or falls back to the production URL.
 */
function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://storypickids.com';
}

/**
 * Get the admin URL for a print order.
 */
export function getOrderAdminUrl(orderId: string): string {
  return `${getBaseUrl()}/admin/print-orders/${orderId}`;
}

/**
 * Common email wrapper with basic styling.
 */
function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    h2 { color: #1a1a1a; margin-bottom: 16px; }
    .order-details { background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .order-details p { margin: 8px 0; }
    .label { color: #666; font-size: 14px; }
    .value { font-weight: 500; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 14px; font-weight: 500; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-approved { background: #d1fae5; color: #065f46; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-shipped { background: #dbeafe; color: #1e40af; }
    .status-cancelled { background: #f3f4f6; color: #4b5563; }
    .btn { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; margin-top: 16px; }
    .btn:hover { background: #1d4ed8; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      <p>This is an automated message from StoryPic Kids.</p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Email template for new order submission.
 */
export function orderSubmittedTemplate(order: PrintOrder): string {
  const adminUrl = getOrderAdminUrl(order.id || '');

  return emailWrapper(`
    <h2>New Print Order Submitted</h2>
    <p>A new print order has been submitted and requires review.</p>

    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      <p><span class="label">Shipping To:</span> <span class="value">${order.shippingAddress?.name || 'N/A'}</span></p>
      <p><span class="label">Quantity:</span> <span class="value">${order.quantity}</span></p>
      <p><span class="label">Status:</span> <span class="status status-pending">Pending Review</span></p>
    </div>

    <a href="${adminUrl}" class="btn">View Order in Admin</a>
  `);
}

/**
 * Email template for order status change.
 */
export function orderStatusChangedTemplate(
  order: PrintOrder,
  oldStatus: string,
  newStatus: string
): string {
  const adminUrl = getOrderAdminUrl(order.id || '');

  const statusClass = getStatusClass(newStatus);
  const statusLabel = formatStatus(newStatus);

  return emailWrapper(`
    <h2>Print Order Status Changed</h2>
    <p>An order status has been updated.</p>

    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      <p><span class="label">Previous Status:</span> <span class="value">${formatStatus(oldStatus)}</span></p>
      <p><span class="label">New Status:</span> <span class="status ${statusClass}">${statusLabel}</span></p>
      ${(order as any).mixamStatusReason ? `<p><span class="label">Reason:</span> <span class="value">${(order as any).mixamStatusReason}</span></p>` : ''}
    </div>

    <a href="${adminUrl}" class="btn">View Order in Admin</a>
  `);
}

/**
 * Email template for order approved.
 */
export function orderApprovedTemplate(order: PrintOrder): string {
  const adminUrl = getOrderAdminUrl(order.id || '');

  return emailWrapper(`
    <h2>Print Order Approved</h2>
    <p>An order has been approved and submitted to the printer.</p>

    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      <p><span class="label">Quantity:</span> <span class="value">${order.quantity}</span></p>
      <p><span class="label">Status:</span> <span class="status status-approved">Approved</span></p>
      ${order.mixamOrderId ? `<p><span class="label">Mixam Order ID:</span> <span class="value">${order.mixamOrderId}</span></p>` : ''}
    </div>

    <a href="${adminUrl}" class="btn">View Order in Admin</a>
  `);
}

/**
 * Email template for order rejected.
 */
export function orderRejectedTemplate(order: PrintOrder, reason?: string): string {
  const adminUrl = getOrderAdminUrl(order.id || '');

  return emailWrapper(`
    <h2>Print Order Rejected</h2>
    <p>An order has been rejected.</p>

    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      <p><span class="label">Status:</span> <span class="status status-rejected">Rejected</span></p>
      ${reason ? `<p><span class="label">Reason:</span> <span class="value">${reason}</span></p>` : ''}
    </div>

    <a href="${adminUrl}" class="btn">View Order in Admin</a>
  `);
}

/**
 * Email template for order cancelled.
 */
export function orderCancelledTemplate(order: PrintOrder, reason?: string): string {
  const adminUrl = getOrderAdminUrl(order.id || '');

  return emailWrapper(`
    <h2>Print Order Cancelled</h2>
    <p>An order has been cancelled.</p>

    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      <p><span class="label">Status:</span> <span class="status status-cancelled">Cancelled</span></p>
      ${reason ? `<p><span class="label">Reason:</span> <span class="value">${reason}</span></p>` : ''}
    </div>

    <a href="${adminUrl}" class="btn">View Order in Admin</a>
  `);
}

// Helper functions

function getStatusClass(status: string): string {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('pending') || statusLower.includes('submitted')) return 'status-pending';
  if (statusLower.includes('approved') || statusLower.includes('confirmed')) return 'status-approved';
  if (statusLower.includes('rejected') || statusLower.includes('failed')) return 'status-rejected';
  if (statusLower.includes('shipped') || statusLower.includes('delivered') || statusLower.includes('production')) return 'status-shipped';
  if (statusLower.includes('cancelled')) return 'status-cancelled';
  return 'status-pending';
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
