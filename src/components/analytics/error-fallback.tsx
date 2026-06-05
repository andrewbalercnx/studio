'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/analytics';
import { Button } from '@/components/ui/button';

type ErrorFallbackProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Use age-appropriate, low-text messaging for the child-facing surfaces. */
  kid?: boolean;
};

/**
 * Shared error-boundary UI used by route-level `error.tsx` files. Reports the error to PostHog Error
 * Tracking via `captureException` (only the digest as context — never the raw message, which can
 * carry PII), then offers a retry.
 */
export function ErrorFallback({ error, reset, kid = false }: ErrorFallbackProps) {
  useEffect(() => {
    captureException(error, { digest: error.digest ?? null });
  }, [error]);

  if (kid) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-6xl" aria-hidden>🙈</div>
        <p className="text-xl font-bold">Oops! Something got muddled.</p>
        <Button size="lg" onClick={reset}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-2xl font-bold">Something went wrong</h2>
      <p className="text-muted-foreground max-w-md">
        We hit an unexpected error. Please try again — if it keeps happening, contact support.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = '/')}>Go home</Button>
      </div>
    </div>
  );
}
