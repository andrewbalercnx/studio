import type { PrintOrder } from '@/lib/types';
import type { EmailConfig, EmailTemplate, EmailTemplateType } from '@/lib/types';
import { getEmailConfig } from './send-email';

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
 * Replace template placeholders with actual values.
 */
function replacePlaceholders(
  template: string,
  values: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

/**
 * Common email wrapper with basic styling.
 * Uses brand color and footer from config.
 */
function emailWrapper(content: string, config: EmailConfig): string {
  const brandColor = config.brandColor || '#2563eb';
  const footerText = config.footerText || 'This is an automated message from StoryPic Kids.';

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
    .btn { display: inline-block; padding: 12px 24px; background: ${brandColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; margin-top: 16px; }
    .btn:hover { opacity: 0.9; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      <p>${footerText}</p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Build email content from a template configuration.
 */
function buildEmailContent(
  template: EmailTemplate,
  config: EmailConfig,
  orderDetails: string,
  buttonUrl: string
): string {
  return emailWrapper(`
    <h2>${template.heading}</h2>
    <p>${template.bodyText}</p>
    ${orderDetails}
    <a href="${template.buttonUrl || buttonUrl}" class="btn">${template.buttonText}</a>
  `, config);
}

/**
 * Build order details section for print order emails.
 */
function buildOrderDetails(
  order: PrintOrder,
  statusClass: string,
  statusLabel: string,
  extras?: string
): string {
  return `
    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      <p><span class="label">Quantity:</span> <span class="value">${order.quantity}</span></p>
      <p><span class="label">Status:</span> <span class="status ${statusClass}">${statusLabel}</span></p>
      ${extras || ''}
    </div>
  `;
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

// ============================================================================
// Email Template Functions (using configurable templates)
// ============================================================================

/**
 * Get the subject line for an email template with placeholders replaced.
 */
export async function getTemplateSubject(
  templateType: EmailTemplateType,
  values: Record<string, string>
): Promise<string> {
  const config = await getEmailConfig();
  const template = config.templates[templateType];
  return replacePlaceholders(template.subject, values);
}

/**
 * Check if a template type is enabled.
 */
export async function isTemplateEnabled(templateType: EmailTemplateType): Promise<boolean> {
  const config = await getEmailConfig();
  return config.templates[templateType]?.enabled ?? true;
}

/**
 * Email template for new order submission.
 */
export async function orderSubmittedTemplate(order: PrintOrder): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.orderSubmitted;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = getOrderAdminUrl(order.id || '');
  const values = { orderId: order.id || '' };

  const details = buildOrderDetails(
    order,
    'status-pending',
    'Pending Review',
    `<p><span class="label">Shipping To:</span> <span class="value">${order.shippingAddress?.name || 'N/A'}</span></p>`
  );

  return {
    subject: replacePlaceholders(template.subject, values),
    html: buildEmailContent(template, config, details, adminUrl),
  };
}

/**
 * Email template for order status change.
 */
export async function orderStatusChangedTemplate(
  order: PrintOrder,
  oldStatus: string,
  newStatus: string
): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.orderStatusChanged;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = getOrderAdminUrl(order.id || '');
  const values = {
    orderId: order.id || '',
    status: formatStatus(newStatus),
  };

  const statusClass = getStatusClass(newStatus);
  const statusLabel = formatStatus(newStatus);

  const extras = `
    <p><span class="label">Previous Status:</span> <span class="value">${formatStatus(oldStatus)}</span></p>
    ${(order as any).mixamStatusReason ? `<p><span class="label">Reason:</span> <span class="value">${(order as any).mixamStatusReason}</span></p>` : ''}
  `;

  const details = `
    <div class="order-details">
      <p><span class="label">Order ID:</span> <span class="value">${order.id}</span></p>
      <p><span class="label">Customer Email:</span> <span class="value">${order.contactEmail}</span></p>
      ${extras}
      <p><span class="label">New Status:</span> <span class="status ${statusClass}">${statusLabel}</span></p>
    </div>
  `;

  return {
    subject: replacePlaceholders(template.subject, values),
    html: buildEmailContent(template, config, details, adminUrl),
  };
}

/**
 * Email template for order approved.
 */
export async function orderApprovedTemplate(order: PrintOrder): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.orderApproved;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = getOrderAdminUrl(order.id || '');
  const values = { orderId: order.id || '' };

  const details = buildOrderDetails(
    order,
    'status-approved',
    'Approved',
    order.mixamOrderId ? `<p><span class="label">Mixam Order ID:</span> <span class="value">${order.mixamOrderId}</span></p>` : ''
  );

  return {
    subject: replacePlaceholders(template.subject, values),
    html: buildEmailContent(template, config, details, adminUrl),
  };
}

/**
 * Email template for order rejected.
 */
export async function orderRejectedTemplate(
  order: PrintOrder,
  reason?: string
): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.orderRejected;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = getOrderAdminUrl(order.id || '');
  const values = { orderId: order.id || '' };

  const details = buildOrderDetails(
    order,
    'status-rejected',
    'Rejected',
    reason ? `<p><span class="label">Reason:</span> <span class="value">${reason}</span></p>` : ''
  );

  return {
    subject: replacePlaceholders(template.subject, values),
    html: buildEmailContent(template, config, details, adminUrl),
  };
}

/**
 * Email template for order cancelled.
 */
export async function orderCancelledTemplate(
  order: PrintOrder,
  reason?: string
): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.orderCancelled;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = getOrderAdminUrl(order.id || '');
  const values = { orderId: order.id || '' };

  const details = buildOrderDetails(
    order,
    'status-cancelled',
    'Cancelled',
    reason ? `<p><span class="label">Reason:</span> <span class="value">${reason}</span></p>` : ''
  );

  return {
    subject: replacePlaceholders(template.subject, values),
    html: buildEmailContent(template, config, details, adminUrl),
  };
}

/**
 * Test email template.
 */
export async function testEmailTemplate(recipientEmail: string): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.testEmail;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = `${getBaseUrl()}/admin`;

  const content = emailWrapper(`
    <h2>${template.heading}</h2>
    <p>${template.bodyText}</p>
    <div class="order-details">
      <p><span class="label">Recipient:</span> <span class="value">${recipientEmail}</span></p>
      <p><span class="label">Sender:</span> <span class="value">${config.senderEmail}</span></p>
      <p><span class="label">Time:</span> <span class="value">${new Date().toISOString()}</span></p>
    </div>
    <a href="${template.buttonUrl || adminUrl}" class="btn">${template.buttonText}</a>
  `, config);

  return {
    subject: template.subject,
    html: content,
  };
}

/**
 * Maintenance error details for error notification emails.
 */
export type MaintenanceErrorDetails = {
  flowName: string;         // Name of the flow/process that errored (e.g., 'storyImageFlow')
  errorType: string;        // Type of error (e.g., 'ImageGenerationFailed', 'RateLimited')
  errorMessage: string;     // Full error message
  pagePath: string;         // URL path where the error occurred (e.g., '/child/abc123/book/xyz/generating')
  diagnostics?: Record<string, any>; // Diagnostic data from the page
  timestamp?: Date;         // When the error occurred
  userId?: string;          // User who encountered the error (if known)
  attemptNumber?: number;   // Retry attempt number (if applicable)
  maxAttempts?: number;     // Max retry attempts (if applicable)
};

/**
 * Email template for maintenance/error notifications.
 * Sent to users with maintenanceUser flag set to true.
 */
export async function maintenanceErrorTemplate(
  details: MaintenanceErrorDetails
): Promise<{ subject: string; html: string } | null> {
  const config = await getEmailConfig();
  const template = config.templates.maintenanceError;

  if (!template.enabled) {
    return null;
  }

  const adminUrl = `${getBaseUrl()}/admin`;

  // Create error message snippet (first 5 words + ellipsis)
  const errorWords = details.errorMessage.trim().split(/\s+/);
  const errorMessageSnippet = errorWords.length > 5
    ? errorWords.slice(0, 5).join(' ') + '...'
    : details.errorMessage;

  const values = {
    flowName: details.flowName,
    errorType: details.errorType,
    errorMessage: details.errorMessage,
    errorMessageSnippet,
  };

  // Build error details section
  const timestamp = details.timestamp || new Date();
  const retryInfo = details.attemptNumber && details.maxAttempts
    ? `<p><span class="label">Attempt:</span> <span class="value">${details.attemptNumber} of ${details.maxAttempts}</span></p>`
    : '';

  const errorDetails = `
    <div class="order-details" style="background: #fef2f2; border: 1px solid #fecaca;">
      <p><span class="label">Flow:</span> <span class="value">${details.flowName}</span></p>
      <p><span class="label">Error Type:</span> <span class="status status-rejected">${details.errorType}</span></p>
      <p><span class="label">Page:</span> <span class="value">${details.pagePath}</span></p>
      <p><span class="label">Time:</span> <span class="value">${timestamp.toISOString()}</span></p>
      ${details.userId ? `<p><span class="label">User:</span> <span class="value">${details.userId}</span></p>` : ''}
      ${retryInfo}
    </div>
    <div class="order-details" style="margin-top: 16px;">
      <p><span class="label">Error Message:</span></p>
      <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(details.errorMessage)}</pre>
    </div>
    ${details.diagnostics ? `
    <div class="order-details" style="margin-top: 16px;">
      <p><span class="label">Diagnostics:</span></p>
      <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 11px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;">${escapeHtml(JSON.stringify(details.diagnostics, null, 2))}</pre>
    </div>
    ` : ''}
  `;

  const content = emailWrapper(`
    <h2>${template.heading}</h2>
    <p>${template.bodyText}</p>
    ${errorDetails}
    <a href="${template.buttonUrl || adminUrl}" class="btn">${template.buttonText}</a>
  `, config);

  return {
    subject: replacePlaceholders(template.subject, values),
    html: content,
  };
}

/**
 * Escape HTML special characters to prevent XSS in emails.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
