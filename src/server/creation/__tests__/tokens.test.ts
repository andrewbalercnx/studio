import { describe, expect, it } from 'vitest';
import { castToken, extractCastIds, normalizeModelText, renderCastTokens, toCastTokenPrompt, tokenizeNames } from '../tokens';

const known: Record<string, string> = { c1: 'c1', Emma: 'c1', childId: 'c1', abcdefghijklmnop123: 'ch9' };
const resolve = (raw: string) => known[raw] ?? null;

describe('cast tokens', () => {
  it('extracts castIds in order of first appearance', () => {
    expect(extractCastIds('[[cast:b]] and [[cast:a]] then [[cast:b]]')).toEqual(['b', 'a']);
    expect(extractCastIds(null)).toEqual([]);
  });

  it('renders names, unknown ids as "a friend"', () => {
    expect(renderCastTokens('[[cast:c1]] met [[cast:zz]].', (id) => (id === 'c1' ? 'Emma' : null))).toBe('Emma met a friend.');
  });

  it("normalises every token form a model emits; never keeps an unknown id", () => {
    expect(normalizeModelText('$$c1$$ and $$Emma$$ and [[cast:c1]] and $abcdefghijklmnop123$', resolve)).toBe(
      '[[cast:c1]] and [[cast:c1]] and [[cast:c1]] and [[cast:ch9]]'
    );
    expect(normalizeModelText('$$childId$$ met $$Bramble$$ and $$zzzzzzzzzzzzzzzzzz9$$', resolve)).toBe('[[cast:c1]] met Bramble and a friend');
    expect(normalizeModelText('costs $5 and $10', resolve)).toBe('costs $5 and $10');
  });

  it('puts tokens back where names were written, whole words only, never inside a token', () => {
    const people = [
      { castId: 'c1', displayName: 'Emma' },
      { castId: 'c2', displayName: 'Emma Rose' },
    ];
    expect(tokenizeNames('Emma Rose and Emma met Emmaline. [[cast:c1]]', people)).toBe('[[cast:c2]] and [[cast:c1]] met Emmaline. [[cast:c1]]');
  });

  it('rewrites curated $$id$$ instructions to cast tokens', () => {
    expect(toCastTokenPrompt('Use $$id$$ placeholders, e.g. "$$abc123$$". Hero: $$CHILD_ID_PLACEHOLDER$$. Price $5.')).toBe(
      `Use ${castToken('id')} placeholders, e.g. "${castToken('abc123')}". Hero: ${castToken('CHILD_ID_PLACEHOLDER')}. Price $5.`
    );
  });
});
