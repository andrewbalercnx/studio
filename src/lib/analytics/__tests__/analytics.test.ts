import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initAnalytics,
  setAnalyticsEnabled,
  isAnalyticsEnabled,
  track,
  identify,
  captureException,
  resetAnalytics,
  __resetAnalyticsForTest,
  ANALYTICS_EVENTS,
  type AnalyticsSink,
} from '@/lib/analytics';
import {
  findPiiViolation,
  isKnownEvent,
  ANALYTICS_EVENT_NAMES,
} from '@/lib/analytics/events';

function makeFakeSink() {
  return {
    capture: vi.fn(),
    identify: vi.fn(),
    captureException: vi.fn(),
    reset: vi.fn(),
  } satisfies AnalyticsSink;
}

describe('analytics core', () => {
  let sink: ReturnType<typeof makeFakeSink>;

  beforeEach(() => {
    sink = makeFakeSink();
    initAnalytics({ sink, enabled: true });
  });

  afterEach(() => {
    __resetAnalyticsForTest();
    vi.restoreAllMocks();
  });

  describe('no-PII contract', () => {
    it('throws (in non-prod) when a name-shaped prop is passed', () => {
      expect(() => track(ANALYTICS_EVENTS.childCreated, { childName: 'Alice' } as any)).toThrow(
        /forbidden key pattern/
      );
      expect(sink.capture).not.toHaveBeenCalled();
    });

    it('throws on photo / image url props', () => {
      expect(() => track(ANALYTICS_EVENTS.storybookArtReady, { photoUrl: 'x' } as any)).toThrow();
      expect(() => track(ANALYTICS_EVENTS.storybookArtReady, { imageUrl: 'x' } as any)).toThrow();
    });

    it('throws on free-text / story content props', () => {
      expect(() => track(ANALYTICS_EVENTS.storyCompleted, { storyText: 'once upon a time' } as any)).toThrow();
      expect(() =>
        track(ANALYTICS_EVENTS.storyCompleted, { note: 'x'.repeat(201) } as any)
      ).toThrow(/too long/);
    });

    it('throws on email-shaped and URL-shaped values', () => {
      expect(() => track(ANALYTICS_EVENTS.signupCompleted, { ref: 'a@b.com' } as any)).toThrow(/email/);
      expect(() => track(ANALYTICS_EVENTS.signupCompleted, { ref: 'https://x.y' } as any)).toThrow(/URL/);
    });

    it('allows id/count/enum scalar props', () => {
      const ok = track(ANALYTICS_EVENTS.printOrderPlaced, {
        orderId: 'ord_123',
        value: 24.99,
        currency: 'GBP',
        childCount: 2,
        storyTypeId: 'adventure',
      });
      expect(ok).toBe(true);
      expect(sink.capture).toHaveBeenCalledWith('print_order.placed', expect.any(Object));
    });
  });

  describe('kill-switch & DNT', () => {
    it('does not forward events when disabled', () => {
      setAnalyticsEnabled(false);
      expect(isAnalyticsEnabled()).toBe(false);
      const sent = track(ANALYTICS_EVENTS.loginCompleted, { method: 'password' });
      expect(sent).toBe(false);
      expect(sink.capture).not.toHaveBeenCalled();
    });

    it('still validates PII even when disabled (so violations surface in dev/tests)', () => {
      setAnalyticsEnabled(false);
      expect(() => track(ANALYTICS_EVENTS.childCreated, { email: 'a@b.com' } as any)).toThrow();
    });

    it('treats Do-Not-Track as disabled', () => {
      vi.stubGlobal('navigator', { doNotTrack: '1' });
      try {
        expect(isAnalyticsEnabled()).toBe(false);
        expect(track(ANALYTICS_EVENTS.loginCompleted, { method: 'password' })).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('identify', () => {
    it('sends only uid + role', () => {
      identify('uid_1', 'parent');
      expect(sink.identify).toHaveBeenCalledWith('uid_1', { role: 'parent' });
    });

    it('no-ops without a sink/enabled', () => {
      setAnalyticsEnabled(false);
      expect(identify('uid_1', 'parent')).toBe(false);
      expect(sink.identify).not.toHaveBeenCalled();
    });

    it('reset clears identity on the sink', () => {
      resetAnalytics();
      expect(sink.reset).toHaveBeenCalled();
    });
  });

  describe('captureException', () => {
    it('forwards the error to the sink when enabled', () => {
      const err = new Error('boom');
      expect(captureException(err)).toBe(true);
      expect(sink.captureException).toHaveBeenCalledWith(err, undefined);
    });

    it('no-ops when disabled', () => {
      setAnalyticsEnabled(false);
      expect(captureException(new Error('boom'))).toBe(false);
      expect(sink.captureException).not.toHaveBeenCalled();
    });

    it('rejects PII in the context (throws in strict mode; drops context + still sends in prod)', () => {
      const err = new Error('boom');
      expect(() => captureException(err, { childName: 'Alice' } as any)).toThrow(/forbidden/);
      expect(sink.captureException).not.toHaveBeenCalled();
    });
  });

  describe('taxonomy', () => {
    it('rejects unknown event names', () => {
      expect(() => track('made.up.event' as any)).toThrow(/unknown event/);
    });

    it('all registered events are unique, snake/dot-cased strings', () => {
      const names = [...ANALYTICS_EVENT_NAMES];
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) {
        expect(n).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
        expect(isKnownEvent(n)).toBe(true);
      }
    });
  });
});

describe('findPiiViolation (pure)', () => {
  it('returns null for clean scalar props', () => {
    expect(findPiiViolation({ orderId: 'x', count: 3, ok: true, nothing: null })).toBeNull();
  });
  it('flags forbidden keys', () => {
    expect(findPiiViolation({ firstName: 'A' })).toMatch(/forbidden/);
    expect(findPiiViolation({ promptText: 'A' })).toMatch(/forbidden/);
  });
});
