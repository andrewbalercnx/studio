import { addDoc, collection, serverTimestamp, Firestore } from 'firebase/firestore';

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
    });
  } catch (err) {
    console.warn('[session-events] Failed to log session event', {
      sessionId,
      event,
      error: (err as Error)?.message ?? err,
    });
  }
}
