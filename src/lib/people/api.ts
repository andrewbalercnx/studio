'use client';

/**
 * Calls to the Children and Characters routes (`/api/children/**`,
 * `/api/characters/**`, slice 5.7). The browser never writes these documents:
 * profile edits, photos, avatars and deletes all go through the server, which
 * also runs the likeness jobs.
 */
import { authFetch } from '@/lib/auth-fetch';

export class PeopleApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'PeopleApiError';
  }
}

async function send<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await authFetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let payload: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new PeopleApiError(payload?.error?.message || 'Something went wrong. Please try again.', payload?.error?.code || 'REQUEST_FAILED', response.status);
  }
  return payload.data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export type PersonKind = 'child' | 'character';
export type LikenessPart = 'describe' | 'portrait' | 'avatar' | 'animate';
export type PartStatus = 'idle' | 'working' | 'failed';
export type AvatarSource = 'portrait' | 'description' | 'photo';

export type Likeness = {
  photos: string[];
  appearance: string | null;
  portrait: string | null;
  avatar: string | null;
  avatarSource: AvatarSource | null;
  avatarAnimation: string | null;
};

type PersonBase = {
  id: string;
  ownerUid: string;
  displayName: string;
  namePronunciation: string | null;
  pronouns: string | null;
  description: string | null;
  likes: string[];
  dislikes: string[];
  /** `YYYY-MM-DD` or null. */
  dateOfBirth: string | null;
  likeness: Likeness;
  /** The avatar was drawn from the words, not a photo: show it as "imagined". */
  avatarImagined: boolean;
  likenessStatus: Record<LikenessPart, PartStatus>;
  photoIds: Array<{ id: string; url: string }>;
};

export type ChildView = PersonBase & { kind: 'child'; preferredVoiceId: string | null; autoReadAloud: boolean };
export type CharacterView = PersonBase & {
  kind: 'character';
  type: string | null;
  relationship: string | null;
  childId: string | null;
  origin: 'parent' | 'story';
  usageCount: number;
};
export type PersonView = ChildView | CharacterView;

export type ProfileInput = {
  displayName: string;
  namePronunciation: string | null;
  pronouns: string | null;
  description: string | null;
  likes: string[];
  dislikes: string[];
  dateOfBirth: string | null;
};
export type ChildInput = ProfileInput & { preferredVoiceId?: string | null; autoReadAloud?: boolean };
export type CharacterInput = ProfileInput & { type: string | null; relationship: string | null; childId: string | null };

const BASE: Record<PersonKind, string> = { child: '/api/children', character: '/api/characters' };

function itemUrl(kind: PersonKind, id: string, rest = ''): string {
  return `${BASE[kind]}/${encodeURIComponent(id)}${rest}`;
}

/** True while any likeness part is still being made, so a page knows to keep refreshing. */
export function likenessBusy(person: Pick<PersonBase, 'likenessStatus'>): boolean {
  return Object.values(person.likenessStatus).some((s) => s === 'working');
}

export const peopleApi = {
  listChildren: () => send<ChildView[]>(`${BASE.child}?view=person`),
  listCharacters: (options: { childId?: string | null; includeHelp?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.childId) params.set('childId', options.childId);
    if (options.includeHelp) params.set('includeHelp', '1');
    const query = params.toString();
    return send<CharacterView[]>(query ? `${BASE.character}?${query}` : BASE.character);
  },
  get: <K extends PersonKind>(kind: K, id: string) =>
    send<K extends 'child' ? ChildView : CharacterView>(kind === 'child' ? `${itemUrl(kind, id)}?view=person` : itemUrl(kind, id)),
  create: <K extends PersonKind>(kind: K, input: (K extends 'child' ? ChildInput : CharacterInput) & { idempotencyKey: string }) =>
    send<K extends 'child' ? ChildView : CharacterView>(BASE[kind], json('POST', input)),
  update: <K extends PersonKind>(kind: K, id: string, patch: Partial<K extends 'child' ? ChildInput : CharacterInput>) =>
    send<K extends 'child' ? ChildView : CharacterView>(itemUrl(kind, id), json('PATCH', patch)),
  remove: (kind: PersonKind, id: string) => send<{ id: string; deleted: true }>(itemUrl(kind, id), json('DELETE')),
  restore: (kind: PersonKind, id: string) => send<PersonView>(itemUrl(kind, id, '/restore'), json('POST')),
  addPhoto: (kind: PersonKind, id: string, dataUrl: string) => send<PersonView>(itemUrl(kind, id, '/photos'), json('POST', { dataUrl })),
  removePhoto: (kind: PersonKind, id: string, photoId: string) => send<PersonView>(itemUrl(kind, id, `/photos/${encodeURIComponent(photoId)}`), json('DELETE')),
  refreshLikeness: (kind: PersonKind, id: string) => send<PersonView>(itemUrl(kind, id, '/likeness/refresh'), json('POST')),
  setAvatar: (kind: PersonKind, id: string, source: AvatarSource, photoId?: string) =>
    send<PersonView>(itemUrl(kind, id, '/avatar'), json('POST', photoId ? { source, photoId } : { source })),
  reassignOwner: (kind: PersonKind, id: string, ownerUid: string) =>
    send<PersonView>(`/api/admin/${kind === 'child' ? 'children' : 'characters'}/${encodeURIComponent(id)}`, json('PATCH', { ownerUid })),
};

/** Read a picked file as a data URL for `addPhoto`. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** A fresh key per create attempt; reuse it for retries of the same attempt. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
