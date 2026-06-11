import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import { getStoryBucket } from '@/firebase/admin/storage';
import {
  qualifiesForTestimonial,
  validateTestimonialSubmission,
  TESTIMONIAL_QUOTE_MAX_LENGTH,
} from '@/lib/feedback/triggers';
import type { FeedbackDoc, FeedbackTestimonial } from '@/lib/types';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // matches the children photo upload cap

function parseDataUrl(dataUrl: string) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('INVALID_DATA_URL');
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function extensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'img';
}

/**
 * POST /api/feedback/testimonial
 *
 * Attaches the optional "share your story" testimonial (Sprint W3-C) to an
 * existing 4–5 star feedback document the caller owns: explicit consent flag,
 * quote, and an optional photo (data URL, uploaded server-side to Storage
 * following the children-photos pattern). Capture only — nothing is displayed
 * publicly yet.
 *
 * Body: { feedbackId, consent: true, quote, photoDataUrl? }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);
    const body = await request.json();

    const validationError = validateTestimonialSubmission(body);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const firestore = await getServerFirestore();
    const feedbackRef = firestore.collection('feedback').doc(body.feedbackId as string);
    const snapshot = await feedbackRef.get();
    if (!snapshot.exists) {
      return NextResponse.json({ ok: false, error: 'Feedback not found' }, { status: 404 });
    }
    const feedback = snapshot.data() as FeedbackDoc;
    if (feedback.parentUid !== user.uid && !user.claims.isAdmin) {
      return NextResponse.json({ ok: false, error: 'Not your feedback' }, { status: 403 });
    }
    if (feedback.action !== 'submitted' || !qualifiesForTestimonial(feedback.rating)) {
      return NextResponse.json(
        { ok: false, error: 'Testimonials can only be attached to 4–5 star feedback' },
        { status: 409 }
      );
    }
    if (feedback.testimonial) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    // Optional photo — same server-side Storage upload pattern as children photos.
    let photoUrl: string | null = null;
    let photoPath: string | null = null;
    if (typeof body.photoDataUrl === 'string' && body.photoDataUrl.length > 0) {
      let parsed: { mimeType: string; buffer: Buffer };
      try {
        parsed = parseDataUrl(body.photoDataUrl.trim());
      } catch {
        return NextResponse.json({ ok: false, error: 'Invalid photo data URL' }, { status: 400 });
      }
      if (!parsed.mimeType.startsWith('image/')) {
        return NextResponse.json({ ok: false, error: 'Only image uploads are supported' }, { status: 400 });
      }
      if (parsed.buffer.length === 0 || parsed.buffer.length > MAX_PHOTO_BYTES) {
        return NextResponse.json(
          { ok: false, error: 'Photo is empty or exceeds the maximum size', maxBytes: MAX_PHOTO_BYTES },
          { status: 413 }
        );
      }
      const objectPath = `users/${feedback.parentUid}/feedback/${snapshot.id}/${Date.now()}.${extensionFromMime(parsed.mimeType)}`;
      const downloadToken = randomUUID();
      const bucket = await getStoryBucket();
      await bucket.file(objectPath).save(parsed.buffer, {
        contentType: parsed.mimeType,
        resumable: false,
        metadata: {
          cacheControl: 'public,max-age=3600',
          metadata: {
            ownerParentUid: feedback.parentUid,
            feedbackId: snapshot.id,
            uploadedBy: user.uid,
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
      });
      photoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${downloadToken}`;
      photoPath = objectPath;
    }

    const testimonial: FeedbackTestimonial = {
      consent: true, // validated above — must be explicitly true
      quote: (body.quote as string).trim().slice(0, TESTIMONIAL_QUOTE_MAX_LENGTH),
      photoUrl,
      photoPath,
      consentedAt: new Date().toISOString(),
    };

    await feedbackRef.update({ testimonial, updatedAt: FieldValue.serverTimestamp() });
    console.log(`[feedback/testimonial] Testimonial attached to ${snapshot.id} by ${user.uid}`);

    return NextResponse.json({ ok: true, feedbackId: snapshot.id });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('[feedback/testimonial] Error:', error?.message);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to save testimonial' },
      { status: 500 }
    );
  }
}
