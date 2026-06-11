/**
 * Degraded-book status derivation — the canonical implementation of the
 * `StoryBookArtStatus` contract in `src/lib/types.ts`.
 *
 * Pure and dependency-free so it runs identically on server (API routes,
 * flows) and client (storybook viewer, kids PWA). Every surface that needs to
 * answer "is this book viewable / orderable / degraded?" MUST use this rather
 * than re-deriving its own rules.
 */

import type {
  StoryBookArtCompleteness,
  StoryBookArtStatus,
  StoryOutputPage,
} from './types';

type PageLike = Pick<StoryOutputPage, 'kind' | 'imagePrompt' | 'imageStatus'> & {
  id?: string;
};

/**
 * Whether a page requires AI-generated art. Title pages, blank pages, and
 * pages without an image prompt never block a book's art completeness.
 * (Mirrors the existing filter used by the storybook viewer and images route.)
 */
export function pageNeedsImage(page: PageLike): boolean {
  return (
    page.kind !== 'title_page' &&
    page.kind !== 'blank' &&
    !!page.imagePrompt &&
    page.imagePrompt.trim().length > 0
  );
}

/**
 * Derive the book-level art rollup from per-page `imageStatus` values.
 *
 * Precedence:
 * 1. No pages at all            -> `none` (not viewable)
 * 2. Any page pending/generating -> `in_progress`
 * 3. Some failed, some ready     -> `degraded` (viewable AND orderable)
 * 4. All illustratable failed    -> `failed` (viewable, NOT orderable)
 * 5. Everything ready / nothing
 *    needs art                   -> `complete`
 */
export function deriveStorybookArtStatus(pages: PageLike[]): StoryBookArtStatus {
  const illustratable = pages.filter(pageNeedsImage);
  const pagesTotal = illustratable.length;
  const pagesReady = illustratable.filter((p) => p.imageStatus === 'ready').length;
  const failedPages = illustratable.filter((p) => p.imageStatus === 'error');
  const pagesFailed = failedPages.length;
  const pagesPending = pagesTotal - pagesReady - pagesFailed;

  let completeness: StoryBookArtCompleteness;
  if (pages.length === 0) {
    completeness = 'none';
  } else if (pagesPending > 0) {
    completeness = 'in_progress';
  } else if (pagesFailed > 0) {
    completeness = pagesReady > 0 ? 'degraded' : 'failed';
  } else {
    completeness = 'complete';
  }

  const isViewable = pages.length > 0;
  const isOrderable =
    isViewable && (completeness === 'complete' || completeness === 'degraded');

  return {
    completeness,
    pagesTotal,
    pagesReady,
    pagesFailed,
    pagesPending,
    failedPageIds: failedPages
      .map((p) => p.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
    isViewable,
    isOrderable,
  };
}

/**
 * Result of gating a print order against the book's art rollup (Sprint W2-C).
 */
export type OrderArtGate = {
  /** The order may proceed as submitted. */
  allowed: boolean;
  /**
   * The order is possible but only with an explicit degraded-art
   * acknowledgement (`acknowledgeDegraded: true` on the order request).
   */
  requiresAcknowledgement: boolean;
  reason?: 'not_orderable' | 'degraded_confirmation_required';
};

/**
 * Server-side gate for ordering a printed book.
 *
 * Policy:
 * - No art rollup available (legacy books predating the contract) -> fail
 *   open; the PDF checks downstream remain the backstop.
 * - `isOrderable === false` (failed/none/in_progress art) -> block.
 * - `degraded` (partial art) -> orderable, but ONLY with an explicit
 *   acknowledgement that some pages will print without art.
 * - `complete` -> allowed.
 */
export function evaluateOrderArtGate(
  artStatus:
    | Pick<StoryBookArtStatus, 'completeness' | 'isOrderable'>
    | null
    | undefined,
  acknowledgeDegraded = false
): OrderArtGate {
  if (!artStatus) {
    return { allowed: true, requiresAcknowledgement: false };
  }
  if (!artStatus.isOrderable) {
    return { allowed: false, requiresAcknowledgement: false, reason: 'not_orderable' };
  }
  if (artStatus.completeness === 'degraded' && !acknowledgeDegraded) {
    return {
      allowed: false,
      requiresAcknowledgement: true,
      reason: 'degraded_confirmation_required',
    };
  }
  return { allowed: true, requiresAcknowledgement: false };
}
