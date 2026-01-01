/**
 * @fileOverview Utility functions for resolving and validating page constraints
 * from the PrintLayout -> PrintProduct chain.
 *
 * Constraint resolution priority:
 * 1. PrintLayout.pageConstraints (if set) - layout-level overrides
 * 2. PrintProduct.mixamSpec.format (if printProductId set) - product defaults
 * 3. Defaults (no constraints)
 *
 * Page count calculation:
 * Total pages = 2 (cover) + blankPages + inside pages
 * The inside PDF must meet minPageCount and be a multiple of 4.
 */

import type { PrintLayout, PrintProduct, PrintLayoutPageConstraints } from './types';

/**
 * Resolved page constraints with source tracking
 */
export type ResolvedPageConstraints = {
  minPages: number;           // 0 = no minimum
  maxPages: number;           // 0 = no maximum
  pageMultiple: 1 | 2 | 4;    // Pages must be divisible by this
  source: 'layout' | 'product' | 'default';
};

/**
 * Default constraints when no layout or product constraints are set
 */
export const DEFAULT_PAGE_CONSTRAINTS: ResolvedPageConstraints = {
  minPages: 0,
  maxPages: 0,
  pageMultiple: 4,  // Default to multiple of 4 for Mixam compatibility
  source: 'default',
};

/**
 * Resolve page constraints from a PrintLayout and optionally its linked PrintProduct.
 *
 * Priority:
 * 1. PrintLayout.pageConstraints (if set)
 * 2. PrintProduct.mixamSpec.format (if printProductId set and product provided)
 * 3. Defaults
 *
 * @param layout - The PrintLayout to resolve constraints from
 * @param product - Optional PrintProduct (loaded separately if layout.printProductId is set)
 * @returns Resolved constraints with source tracking
 */
export function resolvePageConstraints(
  layout: PrintLayout | null | undefined,
  product: PrintProduct | null | undefined
): ResolvedPageConstraints {
  // Priority 1: Layout-level constraints
  if (layout?.pageConstraints) {
    const constraints = layout.pageConstraints;
    // Only use if at least one constraint is defined
    if (
      constraints.minPages !== undefined ||
      constraints.maxPages !== undefined ||
      constraints.pageMultiple !== undefined
    ) {
      return {
        minPages: constraints.minPages ?? 0,
        maxPages: constraints.maxPages ?? 0,
        pageMultiple: constraints.pageMultiple ?? 4,
        source: 'layout',
      };
    }
  }

  // Priority 2: Product constraints (from mixamSpec.format)
  if (product?.mixamSpec?.format) {
    const format = product.mixamSpec.format;
    return {
      minPages: format.minPageCount ?? 0,
      maxPages: format.maxPageCount ?? 0,
      pageMultiple: (format.pageCountIncrement as 1 | 2 | 4) ?? 4,
      source: 'product',
    };
  }

  // Priority 3: Defaults
  return { ...DEFAULT_PAGE_CONSTRAINTS };
}

/**
 * Validation result from validatePageCount
 */
export type PageCountValidation = {
  valid: boolean;             // True if page count meets all constraints
  warnings: string[];         // List of warnings/adjustments needed
  adjustedCount: number;      // The adjusted page count after applying constraints
  paddingNeeded: number;      // Blank pages to add (positive) or pages to remove (negative)
  wasTruncated: boolean;      // True if pages were removed to meet max constraint
};

/**
 * Validate a page count against constraints and calculate adjustments.
 *
 * @param pageCount - The current content page count (excluding covers)
 * @param constraints - The resolved constraints to validate against
 * @returns Validation result with warnings and adjusted count
 */
export function validatePageCount(
  pageCount: number,
  constraints: ResolvedPageConstraints
): PageCountValidation {
  const warnings: string[] = [];
  let adjustedCount = pageCount;
  let wasTruncated = false;

  // Check maximum constraint (truncation)
  if (constraints.maxPages > 0 && pageCount > constraints.maxPages) {
    const pagesToRemove = pageCount - constraints.maxPages;
    warnings.push(
      `WARNING: Content has ${pageCount} pages but maximum is ${constraints.maxPages}. ` +
      `Truncating ${pagesToRemove} page${pagesToRemove === 1 ? '' : 's'}.`
    );
    adjustedCount = constraints.maxPages;
    wasTruncated = true;
  }

  // Check minimum constraint (padding)
  if (constraints.minPages > 0 && adjustedCount < constraints.minPages) {
    const pagesToAdd = constraints.minPages - adjustedCount;
    warnings.push(
      `Added ${pagesToAdd} blank page${pagesToAdd === 1 ? '' : 's'} to meet minimum of ${constraints.minPages}.`
    );
    adjustedCount = constraints.minPages;
  }

  // Check page multiple constraint (additional padding)
  if (constraints.pageMultiple > 1) {
    const remainder = adjustedCount % constraints.pageMultiple;
    if (remainder !== 0) {
      const additionalPadding = constraints.pageMultiple - remainder;
      warnings.push(
        `Added ${additionalPadding} page${additionalPadding === 1 ? '' : 's'} for ${constraints.pageMultiple}-page alignment.`
      );
      adjustedCount += additionalPadding;
    }
  }

  const paddingNeeded = adjustedCount - pageCount;
  const valid = warnings.length === 0;

  return {
    valid,
    warnings,
    adjustedCount,
    paddingNeeded,
    wasTruncated,
  };
}

/**
 * Apply page constraints to an array of pages, padding or truncating as needed.
 *
 * For truncation: Removes pages from the end (keeping front matter and early content).
 * For padding: Caller is responsible for adding blank pages to the array.
 *
 * @param pageCount - Current number of content pages
 * @param constraints - The resolved constraints
 * @returns Object with target count and adjustment info
 */
export function calculateTargetPageCount(
  pageCount: number,
  constraints: ResolvedPageConstraints
): {
  targetCount: number;
  warnings: string[];
  wasTruncated: boolean;
} {
  const validation = validatePageCount(pageCount, constraints);
  return {
    targetCount: validation.adjustedCount,
    warnings: validation.warnings,
    wasTruncated: validation.wasTruncated,
  };
}

/**
 * Build AI prompt instructions for page count based on constraints.
 *
 * @param targetPageCount - The target from StoryOutputType.layoutHints.pageCount (0 = flexible)
 * @param constraints - Resolved page constraints
 * @returns Instruction string for the AI prompt
 */
export function buildPageCountInstruction(
  targetPageCount: number,
  constraints: ResolvedPageConstraints
): string {
  const parts: string[] = [];

  // Target page count guidance
  if (targetPageCount > 0) {
    parts.push(`TARGET PAGE COUNT: Aim for ${targetPageCount} content pages.`);
  } else {
    parts.push(`PAGE COUNT: Use your judgment to create an appropriate number of pages (typically 8-16 for a picture book).`);
  }

  // Constraint guidance
  if (constraints.minPages > 0 && constraints.maxPages > 0) {
    parts.push(`RANGE: Must be between ${constraints.minPages} and ${constraints.maxPages} pages.`);
  } else if (constraints.minPages > 0) {
    parts.push(`MINIMUM: At least ${constraints.minPages} pages required.`);
  } else if (constraints.maxPages > 0) {
    parts.push(`MAXIMUM: No more than ${constraints.maxPages} pages.`);
  }

  return parts.join(' ');
}

/**
 * Result from calculateInteriorPageAdjustment
 */
export type InteriorPageAdjustment = {
  finalInteriorPages: number;  // The adjusted interior page count
  paddingNeeded: number;       // Blank pages to add to reach finalInteriorPages
  wasTruncated: boolean;       // True if pages were removed to meet max constraint
  warnings: string[];          // List of warnings/adjustments made
};

/**
 * Calculate interior page adjustments for a print product.
 *
 * Rules:
 * 1. The number of inside PDF pages must be at least the minimum (minPageCount)
 * 2. Total pages (2 for cover + blankPages + inside pages) must be a multiple of 4
 * 3. If inside pages exceeds maximum, truncate to maximum
 *
 * @param contentPageCount - Number of actual content pages (excluding covers)
 * @param blankPages - Fixed blank pages in the product (e.g., endpapers)
 * @param constraints - Resolved page constraints from product/layout
 * @returns Adjustment details including final page count and padding needed
 */
export function calculateInteriorPageAdjustment(
  contentPageCount: number,
  blankPages: number,
  constraints: ResolvedPageConstraints
): InteriorPageAdjustment {
  const warnings: string[] = [];
  let insidePages = contentPageCount;
  let wasTruncated = false;

  // The cover counts as 2 pages in the total
  const coverPages = 2;

  // Step 1: Ensure inside pages meets minimum
  if (constraints.minPages > 0 && insidePages < constraints.minPages) {
    const pagesToAdd = constraints.minPages - insidePages;
    warnings.push(
      `Padded ${pagesToAdd} page${pagesToAdd === 1 ? '' : 's'} to meet minimum of ${constraints.minPages}.`
    );
    insidePages = constraints.minPages;
  }

  // Step 2: Ensure total is a multiple of 4
  // Total = coverPages + blankPages + insidePages
  const totalBeforeAlignment = coverPages + blankPages + insidePages;
  const remainder = totalBeforeAlignment % 4;
  if (remainder !== 0) {
    const additionalPadding = 4 - remainder;
    warnings.push(
      `Added ${additionalPadding} page${additionalPadding === 1 ? '' : 's'} for 4-page alignment (total: ${totalBeforeAlignment} -> ${totalBeforeAlignment + additionalPadding}).`
    );
    insidePages += additionalPadding;
  }

  // Step 3: Truncate if exceeds maximum
  if (constraints.maxPages > 0 && insidePages > constraints.maxPages) {
    const pagesToRemove = insidePages - constraints.maxPages;
    warnings.push(
      `WARNING: Truncated ${pagesToRemove} page${pagesToRemove === 1 ? '' : 's'} to meet maximum of ${constraints.maxPages}.`
    );
    insidePages = constraints.maxPages;
    wasTruncated = true;

    // After truncation, we may need to re-align to multiple of 4
    // But we must stay at or below maximum, so we can only pad up to max
    const totalAfterTruncation = coverPages + blankPages + insidePages;
    const remainderAfterTruncation = totalAfterTruncation % 4;
    if (remainderAfterTruncation !== 0) {
      // We need to pad, but that would exceed max
      // So we truncate further to get to a valid multiple of 4
      const truncateMore = remainderAfterTruncation;
      insidePages -= truncateMore;
      warnings.push(
        `Reduced by ${truncateMore} more page${truncateMore === 1 ? '' : 's'} to maintain 4-page alignment within maximum.`
      );
    }
  }

  const paddingNeeded = insidePages - contentPageCount;

  return {
    finalInteriorPages: insidePages,
    paddingNeeded: paddingNeeded > 0 ? paddingNeeded : 0,
    wasTruncated,
    warnings,
  };
}
