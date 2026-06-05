'use client';

import { ErrorFallback } from '@/components/analytics/error-fallback';

// Route-level error boundary for the app (parent/storybook/admin surfaces). Reports to PostHog.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}
