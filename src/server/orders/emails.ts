/** Order emails (slice 5.5b): sent after the change commits, best effort. */
import type { PrintOrderV2 } from '../data/schemas/order';

export type SendEmail = (message: { to: string; subject: string; html: string }) => Promise<void>;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function money(order: Pick<PrintOrderV2, 'amountMinor' | 'currency'>): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: order.currency }).format(order.amountMinor / 100);
}

function layout(title: string, body: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#3b2a16">
<h2 style="color:#b45309">${escapeHtml(title)}</h2>${body}
<p style="color:#8a7560;font-size:12px">StoryPic Kids</p></div>`;
}

export function paidEmail(orderId: string, order: PrintOrderV2, baseUrl: string) {
  const copies = order.quantity === 1 ? 'one printed copy' : `${order.quantity} printed copies`;
  return {
    to: order.contactEmail,
    subject: 'Your StoryPic book order is confirmed',
    html: layout(
      'Thank you for your order',
      `<p>We have your payment of ${money(order)} for ${copies} of your book.</p>
<p>It will be printed and posted to ${escapeHtml(order.shippingAddress.name)}, ${escapeHtml(order.shippingAddress.postalCode)}. We will email you again when it is on its way.</p>
<p><a href="${baseUrl}/orders/${encodeURIComponent(orderId)}">See your order</a></p>`
    ),
  };
}

export function shippedEmail(orderId: string, order: PrintOrderV2, baseUrl: string) {
  const tracking = order.mixam.trackingUrl ? `<p><a href="${escapeHtml(order.mixam.trackingUrl)}">Track your parcel</a></p>` : '';
  return {
    to: order.contactEmail,
    subject: 'Your StoryPic book is on its way',
    html: layout('Your book is on its way', `<p>Your printed book has been posted.</p>${tracking}<p><a href="${baseUrl}/orders/${encodeURIComponent(orderId)}">See your order</a></p>`),
  };
}

export function approvalNeededEmail(to: string, orderId: string, order: PrintOrderV2, baseUrl: string) {
  return {
    to,
    subject: `Print order ${orderId} is waiting for approval`,
    html: layout(
      'A paid print order is waiting for approval',
      `<p>${order.quantity} × ${escapeHtml(order.layoutId)}, ${money(order)}, paid by ${order.payment.method ?? 'unknown'}.</p>
<p><a href="${baseUrl}/admin/print-orders">Open print orders</a></p>`
    ),
  };
}
