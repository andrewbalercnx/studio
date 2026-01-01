import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { sendEmail } from '@/lib/email/send-email';

/**
 * POST /api/admin/test-email
 * Sends a test email to verify SMTP configuration.
 * Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    // Get recipient email from request body, default to the admin's own email
    let recipientEmail: string;
    try {
      const body = await request.json();
      recipientEmail = body.email || user.email;
    } catch {
      recipientEmail = user.email || '';
    }

    if (!recipientEmail) {
      return NextResponse.json(
        { ok: false, error: 'No recipient email available' },
        { status: 400 }
      );
    }

    // Check if Microsoft Graph is configured
    if (!process.env.AZURE_TENANT_ID || !process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Microsoft Graph not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables.',
          configured: false
        },
        { status: 503 }
      );
    }

    const timestamp = new Date().toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      dateStyle: 'full',
      timeStyle: 'long'
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    h2 { color: #1a1a1a; margin-bottom: 16px; }
    .success-box { background: #d1fae5; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #10b981; }
    .details { background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .details p { margin: 8px 0; font-size: 14px; }
    .label { color: #666; }
    .value { font-weight: 500; font-family: monospace; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Test Email from StoryPic Kids</h2>

    <div class="success-box">
      <strong>Email is working correctly!</strong>
      <p>Your Microsoft Graph configuration is valid and emails can be sent successfully.</p>
    </div>

    <div class="details">
      <p><span class="label">Sent at:</span> <span class="value">${timestamp}</span></p>
      <p><span class="label">Sent by:</span> <span class="value">${user.email}</span></p>
      <p><span class="label">Method:</span> <span class="value">Microsoft Graph API</span></p>
    </div>

    <div class="footer">
      <p>This is a test email from the StoryPic Kids admin panel.</p>
    </div>
  </div>
</body>
</html>
`;

    await sendEmail({
      to: recipientEmail,
      subject: 'StoryPic Kids - Test Email',
      html,
    });

    console.log(`[test-email] Test email sent to ${recipientEmail} by ${user.email}`);

    return NextResponse.json({
      ok: true,
      message: `Test email sent to ${recipientEmail}`,
      recipient: recipientEmail
    });
  } catch (error: any) {
    console.error('[test-email] Error sending test email:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
