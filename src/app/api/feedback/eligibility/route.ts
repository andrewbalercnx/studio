import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import { isFeedbackTrigger } from '@/lib/feedback/triggers';

/**
 * GET /api/feedback/eligibility?trigger=<trigger>&subjectId=<id>
 *
 * Server-side suppression check for rating prompts (Sprint W3-C): a prompt is
 * eligible only while NO feedback document (submission or dismissal) exists
 * for this parent+trigger+subject. Clients call this before showing a prompt
 * so "never shown twice" holds across devices and sessions.
 *
 * Response: { ok: true, eligible: boolean }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);
    const { searchParams } = new URL(request.url);
    const trigger = searchParams.get('trigger');
    const subjectId = searchParams.get('subjectId');

    if (!isFeedbackTrigger(trigger)) {
      return NextResponse.json({ ok: false, error: 'Invalid trigger' }, { status: 400 });
    }
    if (!subjectId || subjectId.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'subjectId is required' }, { status: 400 });
    }

    const firestore = await getServerFirestore();
    const existing = await firestore
      .collection('feedback')
      .where('parentUid', '==', user.uid)
      .where('trigger', '==', trigger)
      .where('subjectId', '==', subjectId.trim())
      .limit(1)
      .get();

    return NextResponse.json({ ok: true, eligible: existing.empty });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('[feedback/eligibility] Error:', error?.message);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to check eligibility' },
      { status: 500 }
    );
  }
}
