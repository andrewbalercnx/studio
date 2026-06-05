/**
 * Analytics consent (parent-facing).
 *
 * For a children's product, analytics only runs when BOTH the admin kill-switch
 * (`systemConfig/diagnostics.enableAnalytics`) is on AND the parent has granted consent here.
 * Consent is stored locally; changes broadcast a `sp-consent-change` event so the provider re-gates
 * without a reload.
 */
'use client';

const KEY = 'sp_analytics_consent';
export type ConsentState = 'granted' | 'denied' | 'unset';
export const CONSENT_CHANGE_EVENT = 'sp-consent-change';

export function getConsent(): ConsentState {
  if (typeof localStorage === 'undefined') return 'unset';
  const v = localStorage.getItem(KEY);
  return v === 'granted' || v === 'denied' ? v : 'unset';
}

export function setConsent(state: 'granted' | 'denied'): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, state);
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}
