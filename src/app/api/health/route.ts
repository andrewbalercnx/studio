/**
 * GET /api/health — canary/rollback health probe.
 *
 * Purpose: a single endpoint the deploy scripts (scripts/deploy/*) and canary
 * monitoring can poll on a specific Cloud Run revision URL to decide
 * promote vs rollback. See docs/DEPLOYMENT.md.
 *
 * - `version` is the git commit SHA baked at build time (NEXT_PUBLIC_GIT_COMMIT_SHA
 *   via next.config.ts / Docker build-arg), so the response proves WHICH build
 *   is serving — essential when traffic is split across revisions.
 * - `revision`/`service` come from the Cloud Run-provided K_REVISION/K_SERVICE
 *   env vars (absent locally; not secrets).
 * - The Firestore probe is a cheap single-doc read with a hard timeout; a
 *   failed probe returns HTTP 503 so external monitors can alert on status code.
 * - Worked feature-flag example: when the `health_verbose` flag is false the
 *   endpoint returns the minimal `{ status, version }` body and skips the
 *   dependency probe (flag-driven behaviour change without a deploy).
 * - No secrets in the response. Unlike /api/healthz, this endpoint never
 *   exposes logs.
 */

import { NextResponse } from 'next/server';
import { getFeatureFlag } from '@/lib/feature-flags.server';

export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT_MS = 2_000;

// Module-load time ≈ instance start (good enough for canary monitoring).
const startedAtMs = Date.now();

type ProbeResult = { ok: boolean; latencyMs: number; error?: string };

async function probeFirestore(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const probe = (async () => {
      const { getServerFirestore } = await import('@/lib/server-firestore');
      const db = await getServerFirestore();
      // Single cheap document read; existence does not matter, reachability does.
      await db.doc('systemConfig/diagnostics').get();
    })();
    await Promise.race([
      probe,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      // Message only — never a stack, never config values.
      error: error instanceof Error ? error.message : 'unknown error',
    };
  }
}

export async function GET() {
  const version = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ?? 'unknown';

  // Flag read fails open to its default (true) — a flag-system outage must
  // not take the health endpoint down.
  const verbose = await getFeatureFlag('health_verbose');

  if (!verbose) {
    return NextResponse.json(
      { status: 'ok', version },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const firestore = await probeFirestore();
  const healthy = firestore.ok;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version,
      revision: process.env.K_REVISION ?? null,
      service: process.env.K_SERVICE ?? null,
      uptimeSeconds: Math.round((Date.now() - startedAtMs) / 1000),
      timestamp: new Date().toISOString(),
      checks: { firestore },
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
