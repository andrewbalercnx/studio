import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_CONSTRAINTS,
  resolvePageConstraints,
  validatePageCount,
  buildPageCountInstruction,
  calculateInteriorPageAdjustment,
} from '@/lib/print-constraints';

// ─── resolvePageConstraints ──────────────────────────────────────────────────

describe('resolvePageConstraints', () => {
  it('returns defaults when layout and product are null', () => {
    const result = resolvePageConstraints(null, null);
    expect(result.source).toBe('default');
    expect(result.pageMultiple).toBe(4);
  });

  it('enforces a binding floor even with default source', () => {
    // No layout / product → default source, but softcover floor is 8
    const result = resolvePageConstraints(null, null);
    expect(result.minPages).toBeGreaterThanOrEqual(8);
  });

  it('enforces 24-page floor for CASE (hardcover) binding', () => {
    const product = { mixamSpec: { binding: { type: 'case' } } } as any;
    const result = resolvePageConstraints(null, product);
    expect(result.minPages).toBeGreaterThanOrEqual(24);
  });

  it('uses layout constraints at priority 1', () => {
    const layout = { pageConstraints: { minPages: 16, maxPages: 32, pageMultiple: 4 } } as any;
    const product = { mixamSpec: { format: { minPageCount: 8, maxPageCount: 20 } } } as any;
    const result = resolvePageConstraints(layout, product);
    expect(result.source).toBe('layout');
    expect(result.maxPages).toBe(32);
  });

  it('layout binding floor overrides layout minPages when binding demands more', () => {
    const layout = { pageConstraints: { minPages: 4 } } as any;
    const product = { mixamSpec: { binding: { type: 'case' } } } as any;
    const result = resolvePageConstraints(layout, product);
    expect(result.minPages).toBe(24); // binding floor wins
  });

  it('falls back to product constraints when layout has no pageConstraints', () => {
    const layout = { name: 'A4 Portrait' } as any; // no pageConstraints
    const product = {
      mixamSpec: {
        format: { minPageCount: 20, maxPageCount: 60, pageCountIncrement: 4 },
      },
    } as any;
    const result = resolvePageConstraints(layout, product);
    expect(result.source).toBe('product');
    expect(result.maxPages).toBe(60);
  });
});

// ─── validatePageCount ───────────────────────────────────────────────────────

describe('validatePageCount', () => {
  it('is valid when count meets all constraints', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 8, maxPages: 24 };
    const result = validatePageCount(16, constraints);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.adjustedCount).toBe(16);
    expect(result.paddingNeeded).toBe(0);
  });

  it('pads when count is below minimum', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 16, maxPages: 0 };
    const result = validatePageCount(8, constraints);
    expect(result.adjustedCount).toBe(16);
    expect(result.paddingNeeded).toBe(8);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('truncates when count exceeds maximum', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 0, maxPages: 12 };
    const result = validatePageCount(20, constraints);
    expect(result.adjustedCount).toBe(12);
    expect(result.wasTruncated).toBe(true);
  });

  it('aligns up to next multiple of 4', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 0, maxPages: 0, pageMultiple: 4 };
    const result = validatePageCount(10, constraints);
    expect(result.adjustedCount).toBe(12); // next multiple of 4 after 10
    expect(result.paddingNeeded).toBe(2);
  });

  it('no alignment padding when already a valid multiple', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 0, maxPages: 0, pageMultiple: 4 };
    const result = validatePageCount(12, constraints);
    expect(result.valid).toBe(true);
    expect(result.adjustedCount).toBe(12);
  });

  it('applies minimum then alignment (order matters)', () => {
    // count=6, min=8, multiple=4 → pad to 8, then align: 8 is already multiple of 4
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 8, maxPages: 0, pageMultiple: 4 };
    const result = validatePageCount(6, constraints);
    expect(result.adjustedCount).toBe(8);
  });
});

// ─── buildPageCountInstruction ───────────────────────────────────────────────

describe('buildPageCountInstruction', () => {
  it('gives flexible language when targetPageCount is 0', () => {
    const result = buildPageCountInstruction(0, DEFAULT_PAGE_CONSTRAINTS);
    expect(result).toMatch(/judgment/i);
    expect(result).not.toMatch(/aim for/i);
  });

  it('states specific target when targetPageCount > 0', () => {
    const result = buildPageCountInstruction(12, DEFAULT_PAGE_CONSTRAINTS);
    expect(result).toContain('12');
    expect(result).toMatch(/aim for/i);
  });

  it('includes range when both min and max are set', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 8, maxPages: 24 };
    const result = buildPageCountInstruction(0, constraints);
    expect(result).toContain('8');
    expect(result).toContain('24');
    expect(result).toMatch(/between/i);
  });

  it('states minimum only when max is 0', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 16, maxPages: 0 };
    const result = buildPageCountInstruction(0, constraints);
    expect(result).toContain('16');
    expect(result).toMatch(/minimum/i);
    expect(result).not.toMatch(/maximum/i);
  });

  it('states maximum only when min is 0', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 0, maxPages: 20 };
    const result = buildPageCountInstruction(0, constraints);
    expect(result).toContain('20');
    expect(result).toMatch(/maximum/i);
    expect(result).not.toMatch(/minimum/i);
  });
});

// ─── calculateInteriorPageAdjustment ─────────────────────────────────────────

describe('calculateInteriorPageAdjustment', () => {
  it('returns no adjustments when count is already valid', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 8, maxPages: 0 };
    const result = calculateInteriorPageAdjustment(24, 0, constraints);
    expect(result.finalInteriorPages).toBe(24);
    expect(result.paddingNeeded).toBe(0);
    expect(result.wasTruncated).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('pads to minimum when below', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 24, maxPages: 0 };
    const result = calculateInteriorPageAdjustment(16, 0, constraints);
    expect(result.finalInteriorPages).toBeGreaterThanOrEqual(24);
    expect(result.paddingNeeded).toBeGreaterThan(0);
  });

  it('aligns up to multiple of 4', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 0, maxPages: 0 };
    const result = calculateInteriorPageAdjustment(10, 0, constraints);
    expect(result.finalInteriorPages % 4).toBe(0);
    expect(result.finalInteriorPages).toBe(12);
  });

  it('truncates and aligns when exceeding maximum', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 0, maxPages: 20 };
    const result = calculateInteriorPageAdjustment(28, 0, constraints);
    expect(result.wasTruncated).toBe(true);
    expect(result.finalInteriorPages).toBeLessThanOrEqual(20);
    expect(result.finalInteriorPages % 4).toBe(0);
  });

  it('result finalInteriorPages is always a multiple of 4', () => {
    const constraints = { ...DEFAULT_PAGE_CONSTRAINTS, minPages: 24, maxPages: 48 };
    for (const n of [6, 11, 17, 24, 33, 45]) {
      const result = calculateInteriorPageAdjustment(n, 0, constraints);
      expect(result.finalInteriorPages % 4).toBe(0);
    }
  });
});
