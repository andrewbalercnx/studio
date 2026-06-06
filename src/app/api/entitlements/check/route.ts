import { NextResponse } from 'next/server';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import { checkEntitlement } from '@/lib/entitlements/ledger.server';
import type { EntitlementComponentKey } from '@/lib/types';

/**
 * POST /api/entitlements/check
 *
 * Non-consuming pre-flight gate for story creation. The actual decrement happens server-side at
 * the shared completion chokepoint (`/api/storyCompile`, which consumes one `story_allowance` when
 * a story is compiled — covering kids and parent flows alike). This route exists purely so a client
 * can block a user who is already at their limit *before* they invest time in the wizard, giving a
 * friendly early message instead of a dead end at the end.
 *
 * It reads the ledger and reports remaining capacity; it never writes. Because it does not mutate
 * anything, calling it is harmless and idempotent.
 *
 * Only `story_allowance` may be checked here; storybook/print enforcement live in their own routes.
 *
 * Request body:
 * - component: 'story_allowance'  (allowlisted)
 * - childId?: string              (resolves the scope: child pool first, then family)
 *
 * Response:
 * - ok: boolean
 * - allowed: boolean              (false + 402 when at the limit)
 * - remaining: number
 * - source?: 'child' | 'family'
 * - errorMessage?: string
 */

/** Components a client is allowed to pre-flight-check via this endpoint. */
const CLIENT_CHECKABLE: ReadonlySet<EntitlementComponentKey> = new Set(['story_allowance']);

export async function POST(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/entitlements/check', method: 'POST', requestId });

  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    const body = await request.json().catch(() => ({}));
    const component = body?.component as EntitlementComponentKey | undefined;
    const childId = typeof body?.childId === 'string' ? (body.childId as string) : undefined;

    if (!component || !CLIENT_CHECKABLE.has(component)) {
      return NextResponse.json(
        { ok: false, errorMessage: 'Unsupported entitlement component', requestId },
        { status: 400 },
      );
    }

    const firestore = await getServerFirestore();

    // If a child is named, verify it belongs to the caller so the check resolves the right scope.
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

    const result = await checkEntitlement(uid, component, { parentUid: uid, childId });

    if (!result.allowed) {
      logger.info('Entitlement check denied', { uid, component, remaining: result.remaining });
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
      { ok: false, errorMessage: error?.message || 'Failed to check entitlement', requestId },
      { status: 500 },
    );
  }
}
