import { describe, it, expect } from 'vitest';
import {
  isPlaceholderChild,
  excludePlaceholderChildren,
  LEGACY_PLACEHOLDER_DISPLAY_NAME,
} from '@/lib/placeholder-child';

describe('isPlaceholderChild', () => {
  it('detects the legacy auto-seeded "My First Child" profile', () => {
    expect(isPlaceholderChild({ displayName: 'My First Child' })).toBe(true);
    expect(isPlaceholderChild({ displayName: LEGACY_PLACEHOLDER_DISPLAY_NAME })).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isPlaceholderChild({ displayName: 'my first child' })).toBe(true);
    expect(isPlaceholderChild({ displayName: '  My First Child  ' })).toBe(true);
    expect(isPlaceholderChild({ displayName: 'MY FIRST CHILD' })).toBe(true);
  });

  it('respects an explicit isPlaceholder flag', () => {
    expect(isPlaceholderChild({ displayName: 'Ezra', isPlaceholder: true })).toBe(true);
  });

  it('does not flag real children', () => {
    expect(isPlaceholderChild({ displayName: 'Ezra' })).toBe(false);
    expect(isPlaceholderChild({ displayName: 'My First Childhood Friend' })).toBe(false);
    // A real child whose name merely contains the phrase is not a placeholder
    expect(isPlaceholderChild({ displayName: 'First Child' })).toBe(false);
  });

  it('handles null/undefined/empty input safely', () => {
    expect(isPlaceholderChild(null)).toBe(false);
    expect(isPlaceholderChild(undefined)).toBe(false);
    expect(isPlaceholderChild({})).toBe(false);
    expect(isPlaceholderChild({ displayName: '' })).toBe(false);
    expect(isPlaceholderChild({ displayName: null })).toBe(false);
  });
});

describe('excludePlaceholderChildren', () => {
  const ezra = { id: 'ezra-1', displayName: 'Ezra' };
  const placeholder = { id: 'my-first-child-123456', displayName: 'My First Child' };
  const deleted = { id: 'old-1', displayName: 'Maya', deletedAt: { seconds: 1 } };

  it('removes placeholder profiles from a story cast list', () => {
    const result = excludePlaceholderChildren([ezra, placeholder]);
    expect(result).toEqual([ezra]);
  });

  it('also removes soft-deleted profiles', () => {
    const result = excludePlaceholderChildren([ezra, placeholder, deleted]);
    expect(result).toEqual([ezra]);
  });

  it('returns an empty list when only placeholders exist', () => {
    expect(excludePlaceholderChildren([placeholder])).toEqual([]);
  });

  it('passes through real children untouched', () => {
    const maya = { id: 'maya-2', displayName: 'Maya' };
    expect(excludePlaceholderChildren([ezra, maya])).toEqual([ezra, maya]);
  });
});
