'use client';

import { ErrorFallback } from '@/components/analytics/error-fallback';

// Child-facing error boundary for the kids PWA — age-appropriate messaging. Reports to PostHog.
export default function KidsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} kid />;
}
