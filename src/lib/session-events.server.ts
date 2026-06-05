'use server';

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// Bound the events subcollection with a TTL (see Firestore TTL policy in SCHEMA.md).
const EVENT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

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
        expireAt: Timestamp.fromMillis(Date.now() + EVENT_TTL_MS),
      });
  } catch (error) {
    console.warn('[session-events.server] Failed to log session event', {
      sessionId,
      event,
      err: (error as Error)?.message ?? error,
    });
  }
}
