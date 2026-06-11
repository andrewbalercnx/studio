'use client';

/**
 * Post-moment rating prompt (Sprint W3-C).
 *
 * A lightweight, NON-MODAL, dismissible card offered to PARENTS after
 * meaningful moments (first view of a finished book; order placed). Collects
 * 1–5 stars, optional NPS 0–10 and comment; ratings of 4+ unlock an optional
 * consented testimonial step (quote + photo). Suppression is server-backed:
 * the prompt is shown at most once per trigger+subject across devices
 * (GET /api/feedback/eligibility), and show/suppress decisions go through
 * `shouldShowFeedbackPrompt` in src/lib/feedback/triggers.ts.
 *
 * Never render this on /kids/* surfaces.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Camera, Heart, LoaderCircle, Send, Star, X } from 'lucide-react';
import { useUser } from '@/firebase/auth/use-user';
import { track, ANALYTICS_EVENTS } from '@/lib/analytics';
import {
  qualifiesForTestimonial,
  shouldShowFeedbackPrompt,
  type FeedbackTrigger,
} from '@/lib/feedback/triggers';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type Phase = 'rating' | 'testimonial' | 'thanks';

export interface RatingPromptProps {
  trigger: FeedbackTrigger;
  /** The storybook id (book_first_view) or order id (order_placed). */
  subjectId: string | null | undefined;
  /** The trigger moment has been reached (book finished / order confirmed). */
  momentReached: boolean;
  /** 'floating' = bottom-right panel; 'inline' = renders in document flow. */
  variant?: 'floating' | 'inline';
  className?: string;
}

const TRIGGER_TITLES: Record<FeedbackTrigger, string> = {
  book_first_view: 'How was your book?',
  order_placed: 'How was ordering?',
};

export function RatingPrompt({
  trigger,
  subjectId,
  momentReached,
  variant = 'floating',
  className,
}: RatingPromptProps) {
  const { user } = useUser();
  const pathname = usePathname();

  const [serverEligible, setServerEligible] = useState<boolean | null>(null);
  const [closedThisSession, setClosedThisSession] = useState(false);
  const [phase, setPhase] = useState<Phase>('rating');
  const [busy, setBusy] = useState(false);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);

  // Rating step state
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [nps, setNps] = useState<number | null>(null);
  const [comment, setComment] = useState('');

  // Testimonial step state
  const [consent, setConsent] = useState(false);
  const [quote, setQuote] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const shownTracked = useRef(false);

  // Server-side eligibility: has this parent already answered/dismissed this
  // trigger+subject (on any device)?
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!user || !subjectId || !momentReached) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/feedback/eligibility?trigger=${encodeURIComponent(trigger)}&subjectId=${encodeURIComponent(subjectId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!cancelled) setServerEligible(data?.ok ? data.eligible === true : false);
      } catch {
        if (!cancelled) setServerEligible(false); // conservative: don't show
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [user, subjectId, trigger, momentReached]);

  const visible = shouldShowFeedbackPrompt({
    trigger,
    subjectId,
    surface: 'parent', // this component must only be mounted on parent surfaces
    isSignedIn: !!user,
    serverEligible,
    closedThisSession,
    momentReached,
  });

  useEffect(() => {
    if (visible && !shownTracked.current) {
      shownTracked.current = true;
      track(ANALYTICS_EVENTS.feedbackPromptShown, { trigger, subjectId: subjectId ?? undefined });
    }
  }, [visible, trigger, subjectId]);

  const postFeedback = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!user) return null;
      const token = await user.getIdToken();
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ trigger, subjectId, pagePath: pathname, ...payload }),
      });
      return res.json();
    },
    [user, trigger, subjectId, pathname]
  );

  const handleDismiss = useCallback(() => {
    // Hide immediately; record the dismissal best-effort so it never re-shows.
    setClosedThisSession(true);
    track(ANALYTICS_EVENTS.feedbackDismissed, { trigger, subjectId: subjectId ?? undefined });
    postFeedback({ action: 'dismissed' }).catch(() => {});
  }, [postFeedback, trigger, subjectId]);

  const handleSubmitRating = useCallback(async () => {
    if (!rating || busy) return;
    setBusy(true);
    try {
      const data = await postFeedback({
        action: 'submitted',
        rating,
        nps: nps ?? undefined,
        comment: comment.trim() || undefined,
      });
      if (data?.ok) {
        setFeedbackId(data.feedbackId ?? null);
        track(ANALYTICS_EVENTS.feedbackSubmitted, {
          trigger,
          subjectId: subjectId ?? undefined,
          rating,
          nps: nps ?? undefined,
        });
        if (qualifiesForTestimonial(rating) && data.feedbackId && !data.duplicate) {
          setPhase('testimonial');
        } else {
          setPhase('thanks');
        }
      } else {
        // Quietly close on failure — feedback must never block the parent.
        setClosedThisSession(true);
      }
    } catch {
      setClosedThisSession(true);
    } finally {
      setBusy(false);
    }
  }, [rating, nps, comment, busy, postFeedback, trigger, subjectId]);

  const handlePhotoChange = useCallback((file: File | null) => {
    setPhotoError(null);
    setPhotoDataUrl(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('Photo is too large (max 5 MB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }, []);

  const handleSubmitTestimonial = useCallback(async () => {
    if (!user || !feedbackId || !consent || !quote.trim() || busy) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/feedback/testimonial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          feedbackId,
          consent: true,
          quote: quote.trim(),
          photoDataUrl: photoDataUrl ?? undefined,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        track(ANALYTICS_EVENTS.feedbackTestimonialSubmitted, {
          trigger,
          subjectId: subjectId ?? undefined,
          hasConsent: true,
        });
      }
    } catch {
      // Best effort — the rating is already saved.
    } finally {
      setBusy(false);
      setPhase('thanks');
    }
  }, [user, feedbackId, consent, quote, photoDataUrl, busy, trigger, subjectId]);

  // Auto-close the thank-you note shortly after it appears.
  useEffect(() => {
    if (phase !== 'thanks') return;
    const t = setTimeout(() => setClosedThisSession(true), 4000);
    return () => clearTimeout(t);
  }, [phase]);

  if (!visible) return null;

  const idBase = `rating-prompt-${trigger}`;

  return (
    <Card
      role="region"
      aria-label="Quick feedback"
      data-testid="rating-prompt"
      className={clsx(
        'border-primary/20 shadow-lg',
        variant === 'floating' &&
          'fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm sm:w-96',
        className
      )}
    >
      <CardContent className="relative space-y-3 p-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-2 top-2 h-7 w-7 p-0"
          onClick={handleDismiss}
          aria-label="Dismiss feedback prompt"
        >
          <X className="h-4 w-4" />
        </Button>

        {phase === 'rating' && (
          <>
            <div className="pr-8">
              <p className="font-semibold">{TRIGGER_TITLES[trigger]}</p>
              <p className="text-sm text-muted-foreground">
                Takes 10 seconds — it helps us make better books.
              </p>
            </div>

            {/* Stars */}
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Star rating from 1 to 5">
              {[1, 2, 3, 4, 5].map((value) => {
                const active = (hoverRating ?? rating ?? 0) >= value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={rating === value}
                    aria-label={`${value} star${value === 1 ? '' : 's'}`}
                    className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onMouseEnter={() => setHoverRating(value)}
                    onMouseLeave={() => setHoverRating(null)}
                    onClick={() => setRating(value)}
                  >
                    <Star
                      className={clsx(
                        'h-7 w-7',
                        active ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {rating !== null && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    How likely are you to recommend StoryPic to another family? (optional)
                  </Label>
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Recommendation score from 0 to 10">
                    {Array.from({ length: 11 }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={nps === i}
                        aria-label={`${i} out of 10`}
                        onClick={() => setNps(nps === i ? null : i)}
                        className={clsx(
                          'h-7 w-7 rounded border text-xs font-medium transition-colors',
                          nps === i
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-background hover:bg-muted'
                        )}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`${idBase}-comment`} className="text-xs text-muted-foreground">
                    Anything you&apos;d like to tell us? (optional)
                  </Label>
                  <Textarea
                    id={`${idBase}-comment`}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    className="resize-none text-sm"
                  />
                </div>

                <Button size="sm" className="w-full" onClick={handleSubmitRating} disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send feedback
                </Button>
              </div>
            )}
          </>
        )}

        {phase === 'testimonial' && (
          <div className="space-y-3 pr-8">
            <div>
              <p className="flex items-center gap-1.5 font-semibold">
                <Heart className="h-4 w-4 text-rose-500" />
                Share your story?
              </p>
              <p className="text-sm text-muted-foreground">
                We&apos;d love to tell other families about moments like yours. Totally optional.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-quote`} className="text-xs text-muted-foreground">
                A sentence or two in your own words
              </Label>
              <Textarea
                id={`${idBase}-quote`}
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. My daughter asks for her own story every night now…"
                className="resize-none text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-photo`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Camera className="h-3.5 w-3.5" />
                Add a photo (optional)
              </Label>
              <input
                id={`${idBase}-photo`}
                type="file"
                accept="image/*"
                className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1.5 file:text-xs"
                onChange={(e) => handlePhotoChange(e.target.files?.[0] ?? null)}
              />
              {photoError && <p className="text-xs text-destructive">{photoError}</p>}
              {photoDataUrl && !photoError && (
                <p className="text-xs text-muted-foreground">Photo attached ✓</p>
              )}
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id={`${idBase}-consent`}
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor={`${idBase}-consent`} className="text-xs font-normal leading-snug text-muted-foreground">
                I&apos;m happy for StoryPic to use this quote{photoDataUrl ? ' and photo' : ''} in
                marketing (website, social media). You can withdraw consent any time by contacting us.
              </Label>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setPhase('thanks')} disabled={busy}>
                No thanks
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={handleSubmitTestimonial}
                disabled={busy || !consent || !quote.trim()}
              >
                {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Heart className="mr-2 h-4 w-4" />}
                Share
              </Button>
            </div>
          </div>
        )}

        {phase === 'thanks' && (
          <div className="flex items-center gap-2 py-2 pr-8">
            <Heart className="h-5 w-5 text-rose-500" />
            <p className="text-sm font-medium">Thank you — that really helps!</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
