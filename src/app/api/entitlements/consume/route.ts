import { NextResponse } from 'next/server';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import { consumeEntitlement } from '@/lib/entitlements/ledger.server';
import type { EntitlementComponentKey } from '@/lib/types';

/**
 * POST /api/entitlements/consume
 *
 * Server-authoritative pre-flight gate for story creation. The kids/parent clients create the
 * storySession document directly (client SDK), so the only place to enforce the story_allowance
 * quota is a dedicated server route they call first. This atomically checks-and-consumes one unit
 * of the requested allowance under the caller's ledger, scoped to the given child (child pool
 * first, then the family pool — see docs/PRODUCTS.md).
 *
 * Only client-consumable components are permitted here: `story_allowance`. The other components
 * are consumed server-internally (storybook_allowance in /api/storybookV2/create; print_credit at
 * print time) and must never be drainable from an arbitrary client call.
 *
 * Request body:
 * - component: 'story_allowance'  (allowlisted)
 * - childId?: string              (the locked/selected child; resolves the consume scope)
 *
 * Response:
 * - ok: boolean
 * - allowed: boolean              (false + 402 when at the limit)
 * - remaining: number             (units left in the satisfying scope after the decrement)
 * - source?: 'child' | 'family'
 * - errorMessage?: string
 */

/** Components a client is allowed to self-consume via this endpoint. */
const CLIENT_CONSUMABLE: ReadonlySet<EntitlementComponentKey> = new Set(['story_allowance']);

export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/entitlements/consume', method: 'POST', requestId });

  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    const body = await request.json().catch(() => ({}));
    const component = body?.component as EntitlementComponentKey | undefined;
    const childId = typeof body?.childId === 'string' ? (body.childId as string) : undefined;

    if (!component || !CLIENT_CONSUMABLE.has(component)) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Unsupported entitlement component', requestId },
        { status: 400 },
      );
    }

    const firestore = await getServerFirestore();

    // If a child is named, verify it belongs to the caller so the consume is charged to the right
    // scope (a child the caller does not own would otherwise seed a stray bucket in their ledger).
    if (childId) {
      const childSnap = await firestore.collection('children').doc(childId).get();
      if (!childSnap.exists || childSnap.data()?.ownerParentUid !== uid) {
        logger.warn('Child ownership verification failed', { uid, childId });
        return NextResponse.json(
          { ok: false, errorMessage: 'Child not found', requestId },
          { status: 403 },
        );
      }
    }

    const result = await consumeEntitlement(uid, component, { parentUid: uid, childId });

    if (!result.allowed) {
      logger.info('Entitlement consume denied', { uid, component, remaining: result.remaining });
      return NextResponse.json(
        {
          ok: false,
          allowed: false,
          remaining: result.remaining,
          errorMessage:
            "You've used all your stories. Ask a grown-up to add more to keep creating!",
          code: 'ENTITLEMENT_LIMIT',
          requestId,
        },
        { status: 402 },
      );
    }

    return NextResponse.json({
      ok: true,
      allowed: true,
      remaining: result.remaining,
      source: result.source,
      requestId,
    });
  } catch (error: any) {
    if (error instanceof AuthError) {
      const statusCode = error.code === 'UNAUTHENTICATED' ? 401 : 403;
      return NextResponse.json(
        { ok: false, errorMessage: error.message, requestId },
        { status: statusCode },
      );
    }

    logger.error('Unhandled exception', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message || 'Failed to consume entitlement', requestId },
      { status: 500 },
    );
  }
}
