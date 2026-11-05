'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { api, likenessBusy, StoryPicApiError, type CharacterView, type ChildView } from '@/lib/api';

const POLL_MS = 5_000;

type State<T> = { items: T[]; loading: boolean; error: string | null };

function usePeopleList<T extends ChildView | CharacterView>(load: () => Promise<T[]>, key: string) {
  const { user, loading: userLoading } = useUser();
  const [state, setState] = useState<State<T>>({ items: [], loading: true, error: null });

  const reload = useCallback(async () => {
    try {
      const items = await load();
      setState({ items, loading: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
    // `key` stands in for `load`, which is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setState({ items: [], loading: false, error: null });
      return;
    }
    void reload();
  }, [user, userLoading, reload]);

  // Keep refreshing while a likeness job is still making an avatar or portrait.
  const busy = state.items.some(likenessBusy);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);

  /** Replace one item locally (after an edit returned its new view). */
  const replace = useCallback((item: T) => {
    setState((s) => ({ ...s, items: s.items.some((i) => i.id === item.id) ? s.items.map((i) => (i.id === item.id ? item : i)) : [...s.items, item] }));
  }, []);

  return { ...state, loading: state.loading || userLoading, reload, replace };
}

/** The caller's children, from `GET /api/children?view=person`. */
export function useChildren() {
  return usePeopleList<ChildView>(() => api.people.listChildren(), 'children');
}

/** The family's characters (and the help-tour sample), from `GET /api/characters`. */
export function useCharacters() {
  return usePeopleList<CharacterView>(() => api.people.listCharacters({ includeHelp: true }), 'characters');
}

type PersonState<K extends 'child' | 'character'> = {
  person: (K extends 'child' ? ChildView : CharacterView) | null;
  loading: boolean;
  /** The API's error code (e.g. `CHILD_NOT_FOUND`, `FORBIDDEN`), or null. */
  errorCode: string | null;
};

/**
 * One child or character through the API (`PersonView`), refreshed while a
 * likeness job is still working. `id` null means none; reading waits for
 * sign-in.
 */
export function usePerson<K extends 'child' | 'character'>(kind: K, id: string | null) {
  const { user, loading: userLoading } = useUser();
  const [state, setState] = useState<PersonState<K>>({ person: null, loading: !!id, errorCode: null });

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const person = await api.people.get(kind, id);
      setState({ person: person as PersonState<K>['person'], loading: false, errorCode: null });
    } catch (error) {
      setState({ person: null, loading: false, errorCode: error instanceof StoryPicApiError ? error.code : 'REQUEST_FAILED' });
    }
  }, [kind, id]);

  useEffect(() => {
    if (userLoading) return;
    if (!user || !id) {
      setState({ person: null, loading: false, errorCode: null });
      return;
    }
    setState((s) => ({ ...s, loading: s.person?.id !== id }));
    void reload();
  }, [user, userLoading, id, reload]);

  const busy = state.person ? likenessBusy(state.person) : false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);

  return { ...state, loading: state.loading || (userLoading && !!id), reload };
}
