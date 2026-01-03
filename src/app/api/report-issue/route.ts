import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { getServerFirestore } from '@/lib/server-firestore';
import { notifyMaintenanceError } from '@/lib/email/notify-admins';

export async function POST(request: NextRequest) {
  try {
    // Require authentication (any parent or admin user can report issues)
    const verifiedUser = await requireParentOrAdminUser(request);

    const body = await request.json();
    const { message, pagePath, diagnostics } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Message is required' },
        { status: 400 }
      );
    }

    if (!pagePath || typeof pagePath !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Page path is required' },
        { status: 400 }
      );
    }

    const firestore = await getServerFirestore();

    await notifyMaintenanceError(firestore, {
      flowName: 'UserReportedIssue',
      errorType: 'ManualReport',
      errorMessage: message,
      pagePath,
      diagnostics: {
        ...diagnostics,
        reportedBy: {
          uid: verifiedUser.uid,
          email: verifiedUser.email,
        },
      },
      userId: verifiedUser.uid,
      timestamp: new Date(),
    });

    console.log('[report-issue] Issue reported by', verifiedUser.email, 'from', pagePath);

    return NextResponse.json({ ok: true, message: 'Issue reported successfully' });
  } catch (error: any) {
    console.error('[report-issue] Error:', error.message);

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
