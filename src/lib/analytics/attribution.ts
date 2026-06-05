/**
 * First-touch acquisition attribution.
 *
 * On first landing we persist the UTM channel + referring domain into a first-party cookie (set
 * once — first-touch wins). At sign-up we attach those to `signup.completed` so Phase-2 channel CAC
 * is attributable. Only channel-level, non-PII fields are stored (no full URLs, no query bodies);
 * `utm_term`/`utm_content` are intentionally omitted ('content' also trips the no-PII guard).
 */
'use client';

import type { AnalyticsProps } from './index';

const COOKIE = 'sp_attrib';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/** Write the first-touch attribution cookie if one isn't already set. Safe to call on every landing. */
export function captureFirstTouch(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (document.cookie.includes(`${COOKIE}=`)) return; // first-touch only

  const params = new URLSearchParams(window.location.search);
  const data: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) data[k] = v.slice(0, 100);
  }
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).hostname;
      if (host && !host.includes(window.location.hostname)) data.referrer_domain = host;
    }
  } catch {
    /* malformed referrer — ignore */
  }
  if (Object.keys(data).length === 0) data.utm_source = 'direct';

  document.cookie =
    `${COOKIE}=${encodeURIComponent(JSON.stringify(data))};path=/;max-age=${MAX_AGE_SECONDS};SameSite=Lax`;
}

/** Read the stored first-touch attribution as event props (empty if none). */
export function getAttribution(): AnalyticsProps {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!match) return {};
  try {
    return JSON.parse(decodeURIComponent(match[1])) as AnalyticsProps;
  } catch {
    return {};
  }
}
