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
