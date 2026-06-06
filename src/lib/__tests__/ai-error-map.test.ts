import { describe, it, expect } from 'vitest';
import {
  categorizeError,
  toUserSafeMessage,
  USER_SAFE_MESSAGES,
  type UserSafeErrorCategory,
} from '@/lib/ai-error-map';

describe('categorizeError', () => {
  const cases: Array<[unknown, UserSafeErrorCategory]> = [
    // content filtering / safety
    ['Blocked by safety filters', 'content_filtered'],
    ['Image did not match the expected pattern', 'content_filtered'],
    ['content policy violation', 'content_filtered'],
    // rate limit
    ['RESOURCE_EXHAUSTED: quota', 'rate_limit'],
    ['429 Too Many Requests', 'rate_limit'],
    ['rate limit exceeded', 'rate_limit'],
    // timeout
    ['Generation timed out after 120 seconds', 'timeout'],
    ['DEADLINE_EXCEEDED', 'timeout'],
    ['504 Gateway Timeout', 'timeout'],
    // service unavailable
    ['UNAVAILABLE', 'service_unavailable'],
    ['503 Service Unavailable', 'service_unavailable'],
    ['ECONNRESET', 'service_unavailable'],
    ['internal error', 'service_unavailable'],
    // no output
    ['No image returned. finishReason=STOP', 'no_output'],
    ['storyPageFlow returned no pages.', 'no_output'],
    // invalid request
    ['INVALID_ARGUMENT: bad field', 'invalid_request'],
    ['401 Unauthenticated', 'invalid_request'],
    ['404 Not Found', 'invalid_request'],
    // unknown
    ['something nobody anticipated', 'unknown'],
    ['', 'unknown'],
  ];

  it.each(cases)('categorizes %j as %s', (input, expected) => {
    expect(categorizeError(input)).toBe(expected);
  });

  it('accepts Error objects and is case-insensitive', () => {
    expect(categorizeError(new Error('Quota Exceeded'))).toBe('rate_limit');
    expect(categorizeError(new Error('TIMED OUT'))).toBe('timeout');
  });

  it('handles null / undefined / non-error objects without throwing', () => {
    expect(categorizeError(null)).toBe('unknown');
    expect(categorizeError(undefined)).toBe('unknown');
    expect(categorizeError({})).toBe('unknown');
  });

  it('content filtering wins over rate-limit when both tokens present', () => {
    // 'blocked' (content) precedes 'quota' (rate_limit) in rule order
    expect(categorizeError('blocked: quota note')).toBe('content_filtered');
  });
});

describe('toUserSafeMessage', () => {
  it('never returns the raw error string', () => {
    const raw = 'GoogleGenerativeAI Error: RESOURCE_EXHAUSTED projectId=secret-123';
    const safe = toUserSafeMessage(raw);
    expect(safe).not.toContain('RESOURCE_EXHAUSTED');
    expect(safe).not.toContain('secret-123');
    expect(safe).toBe(USER_SAFE_MESSAGES.rate_limit);
  });

  it('maps every category to a non-empty friendly message', () => {
    (Object.keys(USER_SAFE_MESSAGES) as UserSafeErrorCategory[]).forEach((cat) => {
      expect(USER_SAFE_MESSAGES[cat].length).toBeGreaterThan(0);
    });
  });

  it('falls back to the unknown message for unrecognised errors', () => {
    expect(toUserSafeMessage('mystery failure xyz')).toBe(USER_SAFE_MESSAGES.unknown);
  });

  it('the mapping table is exhaustive over UserSafeErrorCategory', () => {
    const expectedCategories: UserSafeErrorCategory[] = [
      'rate_limit',
      'timeout',
      'service_unavailable',
      'content_filtered',
      'no_output',
      'invalid_request',
      'unknown',
    ];
    expect(Object.keys(USER_SAFE_MESSAGES).sort()).toEqual([...expectedCategories].sort());
  });
});
