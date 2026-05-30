import { describe, it, expect } from 'vitest';
import { extractEntityIds } from '@/lib/entity-utils';

describe('extractEntityIds', () => {
  it('returns empty array for empty string', () => {
    expect(extractEntityIds('')).toEqual([]);
  });

  it('returns empty array for falsy input', () => {
    expect(extractEntityIds(null as any)).toEqual([]);
    expect(extractEntityIds(undefined as any)).toEqual([]);
  });

  it('extracts double-dollar-sign placeholders', () => {
    const ids = extractEntityIds('Once $$abc123$$ went to see $$xyz789$$.');
    expect(ids).toEqual(['abc123', 'xyz789']);
  });

  it('extracts single-dollar-sign placeholders (15+ chars)', () => {
    const ids = extractEntityIds('$abcdefghijklmnop$ appeared.');
    expect(ids).toEqual(['abcdefghijklmnop']);
  });

  it('ignores single-dollar ids shorter than 15 chars', () => {
    expect(extractEntityIds('$short$ text')).toEqual([]);
    expect(extractEntityIds('$14charsexact$ text')).toEqual([]);
  });

  it('deduplicates repeated ids', () => {
    const ids = extractEntityIds('$$abc123$$ and $$abc123$$ again.');
    expect(ids).toEqual(['abc123']);
  });

  it('collects both double- and single-dollar ids without duplication', () => {
    const ids = extractEntityIds('$$abc123$$ met $abcdefghijklmnop$.');
    expect(ids).toContain('abc123');
    expect(ids).toContain('abcdefghijklmnop');
    expect(ids).toHaveLength(2);
  });

  it('returns empty when no placeholders present', () => {
    expect(extractEntityIds('Just a plain story text.')).toEqual([]);
  });

  it('handles text with only whitespace', () => {
    expect(extractEntityIds('   ')).toEqual([]);
  });
});
