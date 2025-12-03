'use server';

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

type SessionEventStatus = 'info' | 'started' | 'completed' | 'error';

type LogServerSessionEventParams = {
  firestore: Firestore;
  sessionId: string;
  event: string;
  status?: SessionEventStatus;
  source?: 'client' | 'server';
  attributes?: Record<string, unknown>;
};

export async function logServerSessionEvent({
  firestore,
  sessionId,
  event,
  status = 'info',
  source = 'server',
  attributes = {},
}: LogServerSessionEventParams) {
  try {
    await firestore
      .collection('storySessions')
      .doc(sessionId)
      .collection('events')
      .add({
        event,
        status,
        source,
        attributes,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.warn('[session-events.server] Failed to log session event', {
      sessionId,
      event,
      err: (error as Error)?.message ?? error,
    });
  }
}
