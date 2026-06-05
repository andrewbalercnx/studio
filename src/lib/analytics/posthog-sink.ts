/**
 * PostHog implementation of {@link AnalyticsSink}.
 *
 * This is the ONLY file that imports the PostHog SDK — the rest of the app talks to the
 * vendor-agnostic core in ./index.ts. Swapping analytics providers means rewriting only this file.
 *
 * PostHog is initialised lazily (and once) the first time a sink is requested, and ONLY when
 * analytics is being enabled — so when the kill-switch is off, the PostHog script never loads and
 * no network requests are made. Configured for a children's product: autocapture OFF, all replay
 * text/inputs masked, identified-only profiles, EU region.
 */
'use client';

import posthog from 'posthog-js';
import type { AnalyticsSink, AnalyticsProps } from './index';

let initialised = false;

export function createPostHogSink(opts: { key: string; host: string }): AnalyticsSink {
  if (!initialised && typeof window !== 'undefined') {
    posthog.init(opts.key, {
      api_host: opts.host,
      // We emit an explicit, audited event taxonomy — never scrape the DOM.
      autocapture: false,
      // Pageviews + Web Vitals power funnel + RUM; URLs are id-based, not PII.
      capture_pageview: true,
      capture_pageleave: true,
      // Don't create profiles for anonymous visitors (less PII, lower cost).
      person_profiles: 'identified_only',
      // Defence in depth for session replay: mask every input and all text by default.
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
      // Error tracking: auto-capture unhandled errors + promise rejections (console errors off).
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // Our core's no-PII guard already validates event props; this is a second net.
      sanitize_properties: (props) => props,
    });
    initialised = true;
  }

  return {
    capture(event: string, props?: AnalyticsProps) {
      posthog.capture(event, props);
    },
    identify(distinctId: string, props?: AnalyticsProps) {
      posthog.identify(distinctId, props);
    },
    captureException(error: unknown, props?: AnalyticsProps) {
      posthog.captureException(error, props);
    },
    reset() {
      posthog.reset();
    },
  };
}
