import { addDoc, collection, serverTimestamp, Timestamp, Firestore } from 'firebase/firestore';

// Session events are an operational debug trail, not analytics — bound their growth with a TTL.
// Requires a Firestore TTL policy on the `events` collection-group keyed on `expireAt` (see SCHEMA.md).
const EVENT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

type SessionEventStatus = 'info' | 'started' | 'completed' | 'error';

type LogSessionEventParams = {
  firestore: Firestore;
  sessionId: string;
  event: string;
  status?: SessionEventStatus;
  source?: 'client' | 'server';
  attributes?: Record<string, unknown>;
};

export async function logSessionEvent({
  firestore,
  sessionId,
  event,
  status = 'info',
  source = 'client',
  attributes = {},
}: LogSessionEventParams) {
  try {
    await addDoc(collection(firestore, 'storySessions', sessionId, 'events'), {
      event,
      status,
      source,
      attributes,
      createdAt: serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + EVENT_TTL_MS),
    });
  } catch (err) {
    console.warn('[session-events] Failed to log session event', {
      sessionId,
      event,
      error: (err as Error)?.message ?? err,
    });
  }
}
