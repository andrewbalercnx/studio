import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import { notifyMaintenanceError } from '@/lib/email/notify-admins';
import { buildTicketDoc } from '@/lib/tickets';

/**
 * POST /api/report-issue
 *
 * Sprint W3-C: issue reports are now tracked tickets. The report is persisted
 * to the `tickets` collection (status: open → in_progress → resolved, updated
 * admin-side) AND the maintenance team is still emailed. The ticket is the
 * source of truth; the email is best-effort notification.
 *
 * Response: { ok: true, ticketId }
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication (any parent or admin user can report issues)
    const verifiedUser = await requireParentOrAdminUser(request);

    const body = await request.json();
    const { message, pagePath, diagnostics } = body;

    const firestore = await getServerFirestore();

    // 1. Create the tracked ticket (validates message/pagePath).
    const built = buildTicketDoc({
      parentUid: verifiedUser.uid,
      contactEmail: verifiedUser.email ?? null,
      message,
      pagePath,
      diagnostics,
      nowIso: new Date().toISOString(),
    });
    if (!built.ok) {
      return NextResponse.json({ ok: false, error: built.error }, { status: 400 });
    }

    const ticketRef = await firestore.collection('tickets').add({
      ...built.ticket,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 2. Email the maintenance team (best effort — never lose the ticket over email).
    try {
      await notifyMaintenanceError(firestore, {
        flowName: 'UserReportedIssue',
        errorType: 'ManualReport',
        errorMessage: message,
        pagePath,
        diagnostics: {
          ...diagnostics,
          ticketId: ticketRef.id,
          reportedBy: {
            uid: verifiedUser.uid,
            email: verifiedUser.email,
          },
        },
        userId: verifiedUser.uid,
        timestamp: new Date(),
      });
    } catch (emailError: any) {
      console.warn('[report-issue] Ticket saved but email failed:', emailError?.message);
    }

    console.log(
      '[report-issue] Ticket', ticketRef.id, 'created by', verifiedUser.email, 'from', pagePath
    );

    return NextResponse.json({ ok: true, ticketId: ticketRef.id, message: 'Issue reported successfully' });
  } catch (error: any) {
    console.error('[report-issue] Error:', error.message);

    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    if (error.message?.includes('Unauthorized') || error.message?.includes('authentication')) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { ok: false, error: error.message || 'Failed to report issue' },
      { status: 500 }
    );
  }
}
