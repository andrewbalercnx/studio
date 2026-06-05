/**
 * Wires the PostHog sink into the analytics core and keeps it in sync with auth + the kill-switch.
 *
 * Behaviour:
 *  - PostHog is only initialised when analytics is ENABLED (key present, not hard-off via env, and
 *    the `systemConfig/diagnostics.enableAnalytics` toggle is on). Until then nothing loads or sends.
 *  - Once enabled, the current user is identified by uid + role only (never child PII).
 *
 * Known limitation (follow-up before go-live): the diagnostics config is only read for authenticated
 * users, so anonymous pre-signup events won't fire until the toggle is made readable pre-auth (or a
 * public config doc is added). Most funnel events are post-auth, so this is acceptable while dark.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import {
  initAnalytics,
  setAnalyticsEnabled,
  identify,
  resetAnalytics,
  type UserRole,
} from '@/lib/analytics';
import { createPostHogSink } from '@/lib/analytics/posthog-sink';
import { captureFirstTouch } from '@/lib/analytics/attribution';
import { getConsent, CONSENT_CHANGE_EVENT, type ConsentState } from '@/lib/analytics/consent';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';
// Build-time hard-off: set NEXT_PUBLIC_ANALYTICS_ENABLED=false to disable regardless of the toggle.
const ENV_HARD_OFF = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'false';

function roleOf(claims: Record<string, unknown> | undefined): UserRole {
  if (claims?.isAdmin) return 'admin';
  if (claims?.isWriter) return 'writer';
  return 'parent';
}

export function PostHogAnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { config } = useDiagnostics();
  const { user, idTokenResult } = useUser();
  const [consent, setConsentState] = useState<ConsentState>('unset');
  // Analytics runs only when admin-enabled AND the parent has granted consent (kids product).
  const enabled = !!POSTHOG_KEY && !ENV_HARD_OFF && !!config.enableAnalytics && consent === 'granted';
  const initialisedRef = useRef(false);

  // Track consent locally and react to changes without a reload.
  useEffect(() => {
    const read = () => setConsentState(getConsent());
    read();
    window.addEventListener(CONSENT_CHANGE_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);

  // Record first-touch attribution on landing (first-party cookie only — set once, independent of
  // the analytics toggle; it's only *sent* later, gated, via signup.completed).
  useEffect(() => {
    captureFirstTouch();
  }, []);

  // Attach / toggle the sink whenever the enabled state flips.
  useEffect(() => {
    if (!enabled) {
      setAnalyticsEnabled(false);
      return;
    }
    if (!initialisedRef.current) {
      const sink = createPostHogSink({ key: POSTHOG_KEY!, host: POSTHOG_HOST });
      initAnalytics({ sink, enabled: true });
      initialisedRef.current = true;
    } else {
      setAnalyticsEnabled(true);
    }
  }, [enabled]);

  // Identify on auth changes; clear on logout.
  useEffect(() => {
    if (!enabled || !initialisedRef.current) return;
    if (user?.uid) {
      identify(user.uid, roleOf(idTokenResult?.claims as Record<string, unknown> | undefined));
    } else {
      resetAnalytics();
    }
  }, [enabled, user?.uid, idTokenResult]);

  return <>{children}</>;
}
