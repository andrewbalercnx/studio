import { NextResponse } from 'next/server';
import { createLogger, generateRequestId } from '@/lib/server-logger';
import { requireAuthenticatedUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import { summarizeEntitlements } from '@/lib/entitlements/ledger.server';

/**
 * GET /api/entitlements/summary[?childId=...]
 *
 * Read-only roll-up of how much the caller's family has left to create, for "X stories left" UI.
 * Server-first: the remaining counts are resolved server-side (child pool + family pool) so every
 * client renders the same numbers without re-implementing scope resolution. Never writes the ledger.
 *
 * When `childId` is supplied it is verified to belong to the caller and the counts include that
 * child's own pool plus the family pool; otherwise only the family pool is reported.
 *
 * Response: `{ ok, story: { remaining }, storybook: { remaining } }`.
 */
export async function GET(request: Request) {
  const requestId = generateRequestId();
  const logger = createLogger({ route: '/api/entitlements/summary', method: 'GET', requestId });

  try {
    const user = await requireAuthenticatedUser(request);
    const uid = user.uid;

    const url = new URL(request.url);
    const childId = url.searchParams.get('childId') || undefined;

    if (childId) {
      const firestore = await getServerFirestore();
      const childSnap = await firestore.collection('children').doc(childId).get();
      if (!childSnap.exists || childSnap.data()?.ownerParentUid !== uid) {
        logger.warn('Child ownership verification failed', { uid, childId });
        return NextResponse.json(
          { ok: false, errorMessage: 'Child not found', requestId },
          { status: 403 },
        );
      }
    }

    const summary = await summarizeEntitlements(uid, childId);

    return NextResponse.json({ ok: true, ...summary, requestId });
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
      { ok: false, errorMessage: error?.message || 'Failed to summarize entitlements', requestId },
      { status: 500 },
    );
  }
}
