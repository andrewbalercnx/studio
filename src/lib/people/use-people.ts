'use client';

import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@/firebase/auth/use-user';
import { likenessBusy, peopleApi, type CharacterView, type ChildView } from './api';

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
  return usePeopleList<ChildView>(() => peopleApi.listChildren(), 'children');
}

/** The family's characters (and the help-tour sample), from `GET /api/characters`. */
export function useCharacters() {
  return usePeopleList<CharacterView>(() => peopleApi.listCharacters({ includeHelp: true }), 'characters');
}
