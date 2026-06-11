'use client';

import type { ReactNode } from 'react';
import type { StoryOutputPage } from '@/lib/types';
import { ImageOff } from 'lucide-react';
import clsx from 'clsx';

/**
 * Shared single-page rendering for storybooks (Sprint W2-C).
 *
 * This is THE page presentation used by both the kids' immersive reader
 * (`ImmersivePlayer`) and the parent book view (`ParentBookView`), so the
 * parent sees exactly what the child sees: full-bleed artwork with the page
 * text overlaid on a bottom gradient. Purely presentational — interaction
 * (navigation, audio, editing) belongs to the hosting component, passed in
 * as overlay `children`.
 */
export type BookPageSpreadProps = {
  page: StoryOutputPage;
  /**
   * Resolved text to display ($$id$$ placeholders already substituted).
   * Hosts resolve via useResolvePlaceholders*; falls back to raw page text.
   */
  displayText?: string | null;
  /** `cover` = kids full-bleed (crops); `contain` = parent review (full art visible). */
  fit?: 'cover' | 'contain';
  className?: string;
  /** Overlays (nav buttons, badges, edit affordances) rendered above the page. */
  children?: ReactNode;
};

export function BookPageSpread({
  page,
  displayText,
  fit = 'cover',
  className,
  children,
}: BookPageSpreadProps) {
  const text = displayText ?? page.displayText ?? page.bodyText ?? page.title ?? '';
  const isCoverPage = page.kind === 'cover_front' || page.kind === 'cover_back';

  return (
    <div className={clsx('relative overflow-hidden bg-black select-none', className)}>
      {/* Artwork */}
      {page.imageUrl ? (
        <div
          className="absolute inset-0 bg-center bg-no-repeat transition-opacity duration-500"
          style={{ backgroundImage: `url(${page.imageUrl})`, backgroundSize: fit }}
          role="img"
          aria-label={page.imagePrompt || `Page ${page.pageNumber + 1} artwork`}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
          <ImageOff className="h-10 w-10" aria-hidden="true" />
          <p className="text-sm">No illustration yet</p>
        </div>
      )}

      {/* Gradient for text readability — only covers the bottom portion */}
      <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

      {/* Text content */}
      {text && (
        <div className="absolute bottom-0 left-0 right-0 p-6 pb-safe">
          <div className="max-w-3xl mx-auto">
            {/* Title on cover pages */}
            {isCoverPage && page.title && (
              <h1 className="text-3xl sm:text-4xl font-headline text-white text-center mb-4 drop-shadow-lg">
                {page.title}
              </h1>
            )}

            {/* Body text - fades out on hover to reveal image underneath */}
            <div className="bg-black/50 backdrop-blur-sm rounded-2xl p-6 transition-opacity duration-300 hover:opacity-10">
              <p className="text-xl sm:text-2xl text-white leading-relaxed text-center font-medium">
                {text}
              </p>
            </div>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
