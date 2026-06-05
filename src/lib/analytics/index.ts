/**
 * Product analytics core.
 *
 * This module is intentionally transport-agnostic: it holds an injected {@link AnalyticsSink}
 * (PostHog in production, a fake in tests) and enforces the cross-cutting rules — runtime
 * kill-switch, Do-Not-Track, identify-on-uid-only, and the no-PII contract — before anything
 * reaches the sink. The PostHog wiring lives separately (posthog-sink.ts) so this file has no
 * vendor dependency and is trivially unit-testable.
 *
 * See docs/sprints/SPRINT-01-MEASUREMENT-SPINE.md.
 */
import {
  type AnalyticsEventName,
  type AnalyticsProps,
  findPiiViolation,
  isKnownEvent,
} from './events';

export { ANALYTICS_EVENTS } from './events';
export type { AnalyticsEventName, AnalyticsProps } from './events';

/** Minimal surface an analytics backend must implement. */
export interface AnalyticsSink {
  capture(event: string, props?: AnalyticsProps): void;
  identify(distinctId: string, props?: AnalyticsProps): void;
  captureException(error: unknown, props?: AnalyticsProps): void;
  reset(): void;
}

/** Roles are non-PII and useful for segmentation. */
export type UserRole = 'parent' | 'admin' | 'writer';

let sink: AnalyticsSink | null = null;
let configEnabled = false;

const isStrict = process.env.NODE_ENV !== 'production';

// Pre-init buffer: events validated before the sink attaches (e.g. `login.completed` fires the
// instant after sign-in, before the provider has loaded the config + created the sink). We keep a
// small ring of recent valid events and flush those within a short window on init, so the
// top-of-funnel isn't lost to that race — without replaying a whole pre-consent browsing session.
type BufferedEvent = { event: AnalyticsEventName; props: AnalyticsProps; t: number };
const preInitBuffer: BufferedEvent[] = [];
const BUFFER_MAX = 20;
const BUFFER_WINDOW_MS = 30_000;

function doNotTrack(): boolean {
  // Guard each global independently — Node defines `navigator` but not `window`.
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : undefined;
  const win = typeof window !== 'undefined' ? (window as any) : undefined;
  // Honour DNT across browser variants.
  const dnt = nav?.doNotTrack ?? win?.doNotTrack ?? nav?.msDoNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/** True only when a sink is attached, the runtime toggle is on, and DNT is not set. */
export function isAnalyticsEnabled(): boolean {
  return !!sink && configEnabled && !doNotTrack();
}

/**
 * Attach a sink and set the initial enabled state. Call once at app start with the PostHog sink and
 * the `systemConfig/diagnostics.enableAnalytics` value.
 */
export function initAnalytics(opts: { sink: AnalyticsSink; enabled: boolean }): void {
  sink = opts.sink;
  configEnabled = opts.enabled;
  // Flush recent buffered events (covers the pre-init race) if we're now sending.
  if (isAnalyticsEnabled() && preInitBuffer.length) {
    const now = Date.now();
    for (const e of preInitBuffer) {
      if (now - e.t <= BUFFER_WINDOW_MS) sink!.capture(e.event, e.props);
    }
  }
  preInitBuffer.length = 0;
}

/** Flip the runtime kill-switch (e.g. when the diagnostics config doc changes). */
export function setAnalyticsEnabled(enabled: boolean): void {
  configEnabled = enabled;
}

/** Test/teardown helper — detaches the sink and resets state. */
export function __resetAnalyticsForTest(): void {
  sink = null;
  configEnabled = false;
  preInitBuffer.length = 0;
}

function reportProblem(message: string): void {
  if (isStrict) throw new Error(`[analytics] ${message}`);
  // In production, never throw from instrumentation — drop and warn.
  console.warn(`[analytics] ${message}`);
}

/**
 * Record an event. Validates the name against the taxonomy and enforces the no-PII contract BEFORE
 * checking whether analytics is enabled, so violations surface in tests/dev even when the sink is
 * off. Returns true if the event was forwarded to the sink.
 */
export function track(event: AnalyticsEventName, props: AnalyticsProps = {}): boolean {
  if (!isKnownEvent(event)) {
    reportProblem(`unknown event "${event}" — add it to ANALYTICS_EVENTS`);
    return false;
  }

  const violation = findPiiViolation(props);
  if (violation) {
    reportProblem(`refusing to send event "${event}": ${violation}`);
    return false;
  }

  if (!isAnalyticsEnabled()) {
    // Buffer valid events so a pre-init race isn't lost; flushed (within a window) on init.
    preInitBuffer.push({ event, props, t: Date.now() });
    if (preInitBuffer.length > BUFFER_MAX) preInitBuffer.shift();
    return false;
  }
  sink!.capture(event, props);
  return true;
}

/**
 * Associate subsequent events with a user. Only the uid and role are ever sent — never child PII.
 */
export function identify(uid: string, role?: UserRole): boolean {
  if (!uid) {
    reportProblem('identify called without a uid');
    return false;
  }
  if (!isAnalyticsEnabled()) return false;
  sink!.identify(uid, role ? { role } : {});
  return true;
}

/**
 * Report a caught exception to error tracking. Unhandled errors/rejections are auto-captured by the
 * sink; use this for caught errors you still want visibility on. Optional context props are run
 * through the no-PII guard (the error/stack itself is sent as-is — keep error messages PII-free).
 */
export function captureException(error: unknown, context?: AnalyticsProps): boolean {
  if (context) {
    const violation = findPiiViolation(context);
    if (violation) {
      reportProblem(`refusing to attach context to exception: ${violation}`);
      context = undefined;
    }
  }
  if (!isAnalyticsEnabled()) return false;
  sink!.captureException(error, context);
  return true;
}

/** Clear identity (call on logout). */
export function resetAnalytics(): void {
  sink?.reset();
}
