'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/analytics';

// Root error boundary — catches failures in the root layout itself. Must render its own <html>/<body>
// and stay dependency-light (app providers/styles may be unavailable when this fires).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort: if analytics isn't initialised yet this is a no-op (PostHog's own auto-capture
    // may still record the unhandled error).
    captureException(error, { digest: error.digest ?? null, fatal: true });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>Please try again.</p>
          <button
            onClick={reset}
            style={{ padding: '0.6rem 1.2rem', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
