/**
 * GET /api/flags — server-evaluated feature flags for clients.
 *
 * Per the server-first principle (CLAUDE.md), clients do NOT evaluate Remote
 * Config themselves: this route evaluates every registered flag on the server
 * (env override → Remote Config → systemConfig/featureFlags → in-code
 * default) and returns plain booleans. That keeps evaluation semantics in one
 * place and the Remote Config SDK out of the client bundle.
 *
 * Auth is OPTIONAL: with a Bearer token the user's uid/email feed Remote
 * Config conditions (percentage rollouts, UID allowlists, email-domain
 * targeting); anonymous callers get the unconditioned values. Flag values are
 * not secrets — never gate sensitive data on a flag alone.
 */

import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { getAllFeatureFlags } from '@/lib/feature-flags.server';
import type { FlagContext } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let ctx: FlagContext = {};
  try {
    const user = await requireAuthenticatedUser(request);
    ctx = { uid: user.uid, email: user.email ?? undefined };
  } catch {
    // Anonymous evaluation — uid/email-based conditions simply do not match.
  }

  try {
    const resolved = await getAllFeatureFlags(ctx);
    const flags: Record<string, boolean> = {};
    for (const [key, entry] of Object.entries(resolved)) {
      flags[key] = entry.value;
    }
    return NextResponse.json(
      { ok: true, flags, authenticated: Boolean(ctx.uid) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // getAllFeatureFlags fails open internally; this is a final belt-and-braces.
    console.error('[api/flags] unexpected failure:', error);
    return NextResponse.json({ ok: false, error: 'Failed to evaluate flags' }, { status: 500 });
  }
}
