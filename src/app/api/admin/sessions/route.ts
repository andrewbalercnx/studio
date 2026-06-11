import { NextRequest, NextResponse } from 'next/server';
import { initFirebaseAdminApp } from '@/firebase/admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAdminUser } from '@/lib/server-auth';
import { AuthError } from '@/lib/auth-error';

/**
 * GET /api/admin/sessions
 * Lists recent story sessions with a server-computed `lastError` summary, so the admin sessions
 * view surfaces failure reasons at a glance (server-first: the AI-log join happens here, not in
 * the client).
 *
 * Bounded queries only:
 *  - storySessions ordered by updatedAt desc, limit 100
 *  - aiFlowLogs ordered by createdAt desc, limit 500 (errors filtered in code — avoids needing a
 *    composite (status, createdAt) index)
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdminUser(request);

    await initFirebaseAdminApp();
    const firestore = getFirestore();

    const toMs = (timestamp: any): number | null => {
      if (!timestamp) return null;
      if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
      if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime();
      if (timestamp._seconds !== undefined) return timestamp._seconds * 1000;
      if (timestamp.seconds !== undefined) return timestamp.seconds * 1000;
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date.getTime();
    };

    const [sessionsSnapshot, logsSnapshot] = await Promise.all([
      firestore.collection('storySessions').orderBy('updatedAt', 'desc').limit(100).get(),
      firestore.collection('aiFlowLogs').orderBy('createdAt', 'desc').limit(500).get(),
    ]);

    // Latest error/failure per sessionId from the recent log window.
    const lastErrorBySession = new Map<
      string,
      { flowName: string; message: string; status: string; atMs: number | null }
    >();
    for (const doc of logsSnapshot.docs) {
      const log = doc.data();
      if (log.status !== 'error' && log.status !== 'failure') continue;
      const sessionId = log.sessionId;
      if (!sessionId || lastErrorBySession.has(sessionId)) continue; // docs are newest-first
      lastErrorBySession.set(sessionId, {
        flowName: log.flowName ?? 'unknown',
        message: (log.errorMessage || log.failureReason || 'Unknown error').slice(0, 300),
        status: log.status,
        atMs: toMs(log.createdAt),
      });
    }

    const sessions = sessionsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        childId: data.childId ?? null,
        status: data.status ?? null,
        currentPhase: data.currentPhase ?? null,
        storyTitle: data.storyTitle ?? null,
        storyMode: data.storyMode ?? null,
        promptConfigId: data.promptConfigId ?? null,
        promptConfigLevelBand: data.promptConfigLevelBand ?? null,
        createdAtMs: toMs(data.createdAt),
        updatedAtMs: toMs(data.updatedAt),
        // Server-computed failure summary (null when no recent error for this session)
        lastError: lastErrorBySession.get(doc.id) ?? null,
      };
    });

    return NextResponse.json({ ok: true, sessions });
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, errorMessage: error.message }, { status: error.status });
    }
    console.error('[admin/sessions] Error listing sessions:', error);
    return NextResponse.json(
      { ok: false, errorMessage: error?.message ?? 'Failed to list sessions' },
      { status: 500 }
    );
  }
}
