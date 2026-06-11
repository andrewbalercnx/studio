import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';
import { getServerFirestore } from '@/lib/server-firestore';
import type { SupportTicket } from '@/lib/types';

function toIso(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

/**
 * GET /api/tickets
 *
 * Lists the calling parent's support tickets (Sprint W3-C), newest first,
 * with Firestore timestamps serialised to ISO strings so thin clients render
 * without SDK types. Status updates happen admin-side; parents read status here.
 *
 * Response: { ok: true, tickets: [{ id, message, pagePath, status,
 *   resolutionNote, createdAtIso, updatedAtIso }] }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);
    const firestore = await getServerFirestore();

    // Equality-only query (no orderBy) to avoid a composite index; sort here.
    const snapshot = await firestore
      .collection('tickets')
      .where('parentUid', '==', user.uid)
      .limit(200)
      .get();

    const tickets = snapshot.docs
      .map((doc) => {
        const data = doc.data() as SupportTicket;
        return {
          id: doc.id,
          message: data.message,
          pagePath: data.pagePath,
          status: data.status ?? 'open',
          resolutionNote: data.resolutionNote ?? null,
          createdAtIso: toIso(data.createdAt),
          updatedAtIso: toIso(data.updatedAt),
        };
      })
      .sort((a, b) => (b.createdAtIso ?? '').localeCompare(a.createdAtIso ?? ''));

    return NextResponse.json({ ok: true, tickets });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('[tickets] Error listing tickets:', error?.message);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to list tickets' },
      { status: 500 }
    );
  }
}
