import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import {
  validateFeedbackSubmission,
  type FeedbackAction,
  type FeedbackTrigger,
} from '@/lib/feedback/triggers';
import type { FeedbackDoc } from '@/lib/types';

/**
 * POST /api/feedback
 *
 * Records a parent's response to a rating prompt (Sprint W3-C) in the
 * `feedback` collection — either a rating submission (1–5 stars, optional
 * NPS 0–10 and comment) or a dismissal. Exactly one document is kept per
 * parent+trigger+subject; that document is also what suppresses the prompt
 * from ever being shown again (see GET /api/feedback/eligibility).
 *
 * Server-first: clients never write the collection directly.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);
    const body = await request.json();

    const validationError = validateFeedbackSubmission(body);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const trigger = body.trigger as FeedbackTrigger;
    const subjectId = (body.subjectId as string).trim();
    const action = body.action as FeedbackAction;

    const firestore = await getServerFirestore();
    const feedbackCollection = firestore.collection('feedback');

    // Dedupe: one response per parent+trigger+subject. A prior dismissal or
    // submission means the prompt should never have been shown again; treat a
    // repeat POST as success so the client can quietly close the prompt.
    const existing = await feedbackCollection
      .where('parentUid', '==', user.uid)
      .where('trigger', '==', trigger)
      .where('subjectId', '==', subjectId)
      .limit(1)
      .get();
    if (!existing.empty) {
      return NextResponse.json({ ok: true, duplicate: true, feedbackId: existing.docs[0].id });
    }

    const doc: Omit<FeedbackDoc, 'id'> = {
      parentUid: user.uid,
      trigger,
      subjectId,
      action,
      rating: action === 'submitted' ? body.rating : null,
      nps: action === 'submitted' && Number.isInteger(body.nps) ? body.nps : null,
      comment:
        action === 'submitted' && typeof body.comment === 'string' && body.comment.trim().length > 0
          ? body.comment.trim()
          : null,
      testimonial: null,
      pagePath: typeof body.pagePath === 'string' ? body.pagePath.slice(0, 512) : null,
      source: 'web',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ref = await feedbackCollection.add(doc);
    console.log(`[feedback] ${action} (${trigger}/${subjectId}) by ${user.uid}: ${ref.id}`);

    return NextResponse.json({ ok: true, feedbackId: ref.id });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('[feedback] Error:', error?.message);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to record feedback' },
      { status: 500 }
    );
  }
}
