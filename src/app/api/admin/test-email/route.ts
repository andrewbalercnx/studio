import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { sendEmail } from '@/lib/email/send-email';
import { testEmailTemplate } from '@/lib/email/templates';

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

    // Get the test email template (uses configurable content from Firestore)
    const email = await testEmailTemplate(recipientEmail);

    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'Test email template is disabled in email configuration' },
        { status: 400 }
      );
    }

    await sendEmail({
      to: recipientEmail,
      subject: email.subject,
      html: email.html,
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
