'use client';

/**
 * Stories on the client (slice 5.4).
 *
 * - While a Story is being created: read-only listeners on `stories/{id}` and
 *   its `turns` (owner-read rules; a list query filters on `ownerUid == uid`).
 * - Lists and readers: the API's rendered views (names resolved on the server).
 * - Changes: the creation routes only, with one idempotency key per tap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { useUser } from '@/firebase/auth/use-user';
import { useCollection, useDocument } from '@/lib/firestore-hooks';
import { ChoiceKeys } from '@/lib/books/api';
import {
  createStory,
  getStory,
  isRetryLater,
  listCreationModes,
  listStories,
  sendTurn,
  type ChildInput,
} from '@/lib/stories/api';
import type { CreationModeId, CreationModeView, StoryDoc, StoryTurnResult, StoryTurnView, StoryView, TurnDoc } from '@/lib/stories/types';

/** `stories/{storyId}` (live). */
export function useStoryDoc(storyId: string | null | undefined) {
  const firestore = useFirestore();
  const { user, loading: userLoading } = useUser();
  const uid = user?.uid;
  // Wait for auth: a read before the token is ready is denied and ends the listener.
  const ref = useMemo(() => (firestore && storyId && uid ? doc(firestore, 'stories', storyId) : null), [firestore, storyId, uid]);
  const result = useDocument<StoryDoc>(ref);
  return { ...result, loading: userLoading || (!!uid && !!storyId && result.loading) };
}

/** `stories/{storyId}/turns` (live), in conversation order. */
export function useStoryTurns(storyId: string | null | undefined) {
  const firestore = useFirestore();
  const { user } = useUser();
  const uid = user?.uid;
  const q = useMemo(
    () => (firestore && storyId && uid ? query(collection(firestore, 'stories', storyId, 'turns'), where('ownerUid', '==', uid)) : null),
    [firestore, storyId, uid]
  );
  const result = useCollection<TurnDoc>(q);
  const turns = useMemo(() => (result.data ? [...result.data].sort((a, b) => a.index - b.index) : []), [result.data]);
  return { turns, loading: result.loading || !uid, error: result.error };
}

function useApiValue<T>(load: (() => Promise<T>) | null) {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!load) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (!cancelled) setValue(result);
      })
      .catch((err) => {
        console.error('[stories] load failed', err);
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { value, loading, error, reload };
}

/** The child's Stories (server status, names resolved), newest first. */
export function useStoryList(childId: string | null | undefined) {
  const { user } = useUser();
  const uid = user?.uid;
  const load = useMemo(() => (uid && childId ? () => listStories(childId) : null), [uid, childId]);
  const { value, ...rest } = useApiValue<StoryView[]>(load);
  return { stories: value ?? [], ...rest };
}

/** One Story as the reader shows it, with its turns. */
export function useStoryView(storyId: string | null | undefined) {
  const { user } = useUser();
  const uid = user?.uid;
  const load = useMemo(() => (uid && storyId ? () => getStory(storyId) : null), [uid, storyId]);
  const { value, ...rest } = useApiValue<{ story: StoryView; turns: StoryTurnView[] }>(load);
  return { story: value?.story ?? null, turns: value?.turns ?? [], ...rest };
}

/** The modes the chooser offers (server list). */
export function useCreationModes() {
  const { user } = useUser();
  const uid = user?.uid;
  const load = useMemo(() => (uid ? () => listCreationModes() : null), [uid]);
  const { value, ...rest } = useApiValue<CreationModeView[]>(load);
  return { modes: value ?? [], ...rest };
}

/**
 * Start a Story with `POST /api/stories`. One key per (child, mode): a double
 * tap, or tapping again after a network error, repeats it and the server
 * returns the same Story; choosing another mode gets a new key.
 */
export function useCreateStory() {
  const [pending, setPending] = useState(false);
  const keys = useRef(new ChoiceKeys());
  const create = useCallback(async (input: { childId: string; modeId: CreationModeId }): Promise<StoryTurnResult> => {
    const idempotencyKey = keys.current.keyFor(`${input.childId}|${input.modeId}`);
    setPending(true);
    try {
      return await createStory({ ...input, idempotencyKey });
    } finally {
      setPending(false);
    }
  }, []);
  return { createStory: create, pending };
}

const RETRY_DELAYS_MS = [1500, 3000, 5000, 8000];

/**
 * Send the child's answer to the prompt at `promptIndex`. One key per answer:
 * a double tap or a "try again" repeats it, so the server records the turn
 * once. While the server is still working on the same answer (409
 * TURN_IN_PROGRESS) the hook waits and asks again with the same key; other
 * errors are returned to the caller.
 */
export function useSendTurn(storyId: string) {
  const [pending, setPending] = useState(false);
  const keys = useRef(new ChoiceKeys());
  const inFlight = useRef<string | null>(null);

  const send = useCallback(
    async (promptIndex: number, input: ChildInput): Promise<StoryTurnResult | null> => {
      const signature = `${promptIndex}|${JSON.stringify(input)}`;
      // The same answer tapped twice while the first request runs: ignore the second tap.
      if (inFlight.current === signature) return null;
      inFlight.current = signature;
      const idempotencyKey = keys.current.keyFor(signature);
      setPending(true);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            return await sendTurn(storyId, input, idempotencyKey);
          } catch (error) {
            const inProgress = error instanceof Error && (error as { code?: string }).code === 'TURN_IN_PROGRESS';
            if (!inProgress || attempt >= RETRY_DELAYS_MS.length) throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          }
        }
      } finally {
        inFlight.current = null;
        setPending(false);
      }
    },
    [storyId]
  );

  return { send, pending, isRetryLater };
}
