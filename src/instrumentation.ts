/**
 * Next.js instrumentation hook — runs once when the server process starts.
 *
 * Used to back-fill any image style scene exemplars that were not yet generated
 * (e.g. on first deployment after the feature was added, or after a new style
 * is seeded). The check is read-only and fast; generation only fires for styles
 * with missing or not-ready exemplar entries.
 */

export async function register() {
  // Only run in the Node.js runtime — not in the Edge runtime, and not during
  // next build (NEXT_PHASE check guards against build-time execution).
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return;
  }

  // In non-production: capture console output into an in-memory ring buffer
  // so the healthz endpoint can surface recent log lines for diagnostics.
  if (process.env.NODE_ENV !== 'production') {
    const { appendLog } = await import('@/lib/dev-log-buffer');
    const wrap = (orig: (...a: any[]) => void, prefix = '') =>
      (...args: any[]) => {
        appendLog(prefix + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        orig(...args);
      };
    console.log   = wrap(console.log.bind(console));
    console.info  = wrap(console.info.bind(console));
    console.warn  = wrap(console.warn.bind(console), '[warn] ');
    console.error = wrap(console.error.bind(console), '[error] ');
  }

  // Dynamic import keeps this out of the edge bundle entirely
  const { backfillMissingSceneExemplars } = await import(
    '@/lib/scene-exemplar-backfill'
  );

  // Fire and forget — must never block startup
  backfillMissingSceneExemplars().catch(e =>
    console.error('[instrumentation] Unhandled backfill error:', e?.message ?? e)
  );
}
