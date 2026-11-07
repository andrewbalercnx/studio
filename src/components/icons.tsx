import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** The StoryPic Kids mark: an open book with a spark. Shares its geometry with
 *  the app icon and the mobile app (see public/icons/magical-book.svg). */
export function BookSparkMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M32 22 C24 16.5 14 16.5 7 20 L7 46 C14 42.5 24 42.5 32 48 Z" fill="currentColor" fillOpacity="0.95" />
      <path d="M32 22 C40 16.5 50 16.5 57 20 L57 46 C50 42.5 40 42.5 32 48 Z" fill="currentColor" fillOpacity="0.72" />
      <path d="M32 22 L32 48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5" />
      <path d="M46 6 L48 12.5 L54.5 14.5 L48 16.5 L46 23 L44 16.5 L37.5 14.5 L44 12.5 Z" className="fill-[hsl(38_92%_55%)]" />
    </svg>
  );
}

export function Logo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <div className="bg-gradient-to-br from-primary to-accent p-1.5 rounded-lg text-white shadow-sm">
        <BookSparkMark className="h-6 w-6" />
      </div>
      <span className="font-headline text-xl font-bold text-foreground hidden sm:inline-block">
        StoryPic Kids
      </span>
    </div>
  );
}
