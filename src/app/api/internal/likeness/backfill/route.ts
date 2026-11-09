import { NextResponse } from 'next/server';
import { isInternalSecretValid } from '@/lib/internal-secret';
import { backfillLikeness, getPeopleDeps, type BackfillTarget } from '@/server/characters';
import type { PersonKind } from '@/server/data/schemas/people';

/**
 * Internal, secret-protected likeness backfill.
 *
 * Enqueues `likeness.describe` + `likeness.portrait` for persons that have
 * photos but are missing the generated appearance/portrait (pre-pipeline
 * profiles the per-photo trigger never ran for). Unlike `…/likeness/refresh`,
 * this acts as the system — ownership is read from each document — so it needs
 * no user auth and is not an impersonation path.
 *
 * POST /api/internal/likeness/backfill
 * Header: X-Internal-Secret: <secret>
 * Body:   { "scanMissing": true }                          // every profile missing its likeness
 *     or  { "targets": [{ "kind": "child", "id": "…" }] }  // specific profiles
 */
export async function POST(request: Request) {
  const secret = request.headers.get('X-Internal-Secret');
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    console.error('[internal/likeness/backfill] INTERNAL_API_SECRET not configured');
    return NextResponse.json({ ok: false, errorMessage: 'Internal API not configured' }, { status: 500 });
  }
  if (!isInternalSecretValid(secret, expected)) {
    return NextResponse.json({ ok: false, errorMessage: 'Invalid or missing internal secret' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const scanMissing = body?.scanMissing === true;
  const targets: BackfillTarget[] = Array.isArray(body?.targets)
    ? body.targets
        .filter((t: unknown): t is { kind: PersonKind; id: string } => {
          const v = t as { kind?: unknown; id?: unknown };
          return (v?.kind === 'child' || v?.kind === 'character') && typeof v?.id === 'string' && v.id.trim().length > 0;
        })
        .map((t: { kind: PersonKind; id: string }) => ({ kind: t.kind, id: t.id }))
    : [];

  if (!scanMissing && targets.length === 0) {
    return NextResponse.json(
      { ok: false, errorMessage: 'Provide scanMissing:true or a non-empty targets:[{kind,id}]' },
      { status: 400 },
    );
  }

  try {
    const result = await backfillLikeness(await getPeopleDeps(), { targets, scanMissing });
    console.log(`[internal/likeness/backfill] scanned=${result.scanned} enqueued=${result.enqueued.length} skipped=${result.skipped.length}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    console.error('[internal/likeness/backfill] POST Error:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error instanceof Error ? error.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
