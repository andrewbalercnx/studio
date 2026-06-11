'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { StoryOutputPage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Pencil, RefreshCw, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useResolvePlaceholdersMultiple } from '@/hooks/use-resolve-placeholders';
import { BookPageSpread } from './book-page-spread';

/**
 * Parent book view (Sprint W2-C): the same page presentation the child sees
 * (shared `BookPageSpread` renderer + the immersive reader's navigation
 * affordances) with exactly one addition — an Edit button on each page.
 *
 * Pages render with `fit="contain"` so the parent reviews the FULL artwork
 * (the kids reader crops full-bleed with `cover`).
 */
export type ParentBookViewProps = {
  pages: StoryOutputPage[];
  /** Open the per-page editor for this page. */
  onEditPage?: (page: StoryOutputPage) => void;
  /** Retry art generation for a failed page. */
  onRetryPage?: (page: StoryOutputPage) => void;
  /** Disables edit/retry actions (e.g. while a generation job runs or book is locked). */
  actionsDisabled?: boolean;
  className?: string;
};

export function ParentBookView({
  pages,
  onEditPage,
  onRetryPage,
  actionsDisabled = false,
  className,
}: ParentBookViewProps) {
  // Blank pages exist for print alignment only — never shown when reading.
  const displayablePages = useMemo(() => pages.filter((p) => p.kind !== 'blank'), [pages]);

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const totalPages = displayablePages.length;
  const safeIndex = Math.max(0, Math.min(currentPageIndex, totalPages - 1));
  const currentPage = displayablePages[safeIndex];
  const hasNextPage = safeIndex < totalPages - 1;
  const hasPrevPage = safeIndex > 0;

  // Keep the index in range when pages stream in/out.
  useEffect(() => {
    if (currentPageIndex >= totalPages && totalPages > 0) {
      setCurrentPageIndex(totalPages - 1);
    }
  }, [currentPageIndex, totalPages]);

  // Resolve $$id$$ placeholders for every page (same as the kids reader).
  const pageTexts = useMemo(
    () => displayablePages.map((p) => p.displayText || p.bodyText || p.title || null),
    [displayablePages]
  );
  const { resolvedTexts } = useResolvePlaceholdersMultiple(pageTexts);
  const displayText =
    resolvedTexts[safeIndex] ||
    currentPage?.displayText ||
    currentPage?.bodyText ||
    currentPage?.title ||
    '';

  const goToNextPage = useCallback(() => {
    setCurrentPageIndex((prev) => Math.min(prev + 1, totalPages - 1));
  }, [totalPages]);

  const goToPrevPage = useCallback(() => {
    setCurrentPageIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't steal arrow keys from form fields (e.g. the page editor dialog).
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNextPage, goToPrevPage]);

  if (!currentPage) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No pages available
      </div>
    );
  }

  const pageFailed = currentPage.imageStatus === 'error';

  return (
    <div className={clsx('space-y-3', className)}>
      <BookPageSpread
        page={currentPage}
        displayText={displayText}
        fit="contain"
        className="rounded-xl h-[55vh] min-h-[320px] w-full"
      >
        {/* Page indicator — same placement as the kids reader */}
        <div className="absolute top-4 left-4 text-white/70 text-sm font-medium">
          {safeIndex + 1} / {totalPages}
        </div>

        {/* Edit button — the one parent-only addition */}
        {onEditPage && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute top-3 right-3 bg-white/90 hover:bg-white text-foreground shadow-lg"
            onClick={() => onEditPage(currentPage)}
            disabled={actionsDisabled}
            data-wiz-target="storybook-edit-page"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit page
          </Button>
        )}

        {/* Failed-art notice with targeted retry */}
        {pageFailed && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 w-[90%] max-w-md rounded-lg bg-amber-50/95 border border-amber-200 p-3 text-amber-900 text-sm shadow-lg">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              This picture didn&apos;t finish
            </p>
            <p className="mt-1">
              {currentPage.imageMetadata?.lastErrorMessage ??
                'The picture could not be painted this time.'}{' '}
              The rest of the book is fine.
            </p>
            {onRetryPage && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 border-amber-300 bg-white/80"
                onClick={() => onRetryPage(currentPage)}
                disabled={actionsDisabled}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Try this picture again
              </Button>
            )}
          </div>
        )}

        {/* Navigation buttons — same affordances as the kids reader */}
        {hasPrevPage && (
          <button
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white rounded-full p-3 transition-colors"
            onClick={goToPrevPage}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
        )}
        {hasNextPage && (
          <button
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white rounded-full p-3 transition-colors"
            onClick={goToNextPage}
            aria-label="Next page"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        )}
      </BookPageSpread>

      {/* Progress dots — clickable for the parent (review needs random access) */}
      <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="Pages">
        {displayablePages.map((page, idx) => {
          const failed = page.imageStatus === 'error';
          return (
            <button
              key={page.id ?? idx}
              role="tab"
              aria-selected={idx === safeIndex}
              aria-label={`Page ${idx + 1}${failed ? ' (picture missing)' : ''}`}
              onClick={() => setCurrentPageIndex(idx)}
              className={clsx(
                'h-2.5 rounded-full transition-all duration-300',
                idx === safeIndex ? 'w-5' : 'w-2.5',
                failed
                  ? 'bg-amber-500'
                  : idx === safeIndex
                    ? 'bg-primary'
                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/60'
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
