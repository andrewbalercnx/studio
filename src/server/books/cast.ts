/**
 * The Story's cast and each member's likeness inputs (domain-model.md "Cast",
 * ADR-0006), built from today's story (`actors[]` + `childId`) and the family's
 * `children` / `characters` documents.
 *
 * Rules:
 * - Every lookup is owner-scoped: a child or character belongs to the cast only
 *   if its `ownerParentUid` is the story's owner. There is no cross-family lookup
 *   by id or by name (as-is characters-actors.md bug 3).
 * - Likeness: `portrait` = `canonicalImageUrl`; `appearance` = `imageDescription`
 *   (generated from the original photos, CLAUDE.md rule — never regenerated
 *   here); `photos` = the original uploads. `avatarUrl` is never a likeness
 *   (it may be a picsum placeholder), and any placeholder URL is dropped.
 * - One token parser for story text: `$$id$$`, the single-dollar AI fallback
 *   `$id$` (15+ id chars) and the target `[[cast:id]]`.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { CastMember } from '../data/schemas/story';
import type { StorySource } from './story-source';

export type CastLikeness = {
  portrait: string | null;
  appearance: string | null;
  photos: string[];
};

export type CastEntry = CastMember & {
  displayName: string;
  pronouns: string | null;
  /** How the name is spoken (TTS); null = as written. */
  namePronunciation: string | null;
  description: string | null;
  /** Characters only: Pet, Friend, Family… */
  characterType: string | null;
  likes: string[];
  /** Children only: e.g. `5 years old`. */
  age: string | null;
  /** Children only: narration voice preference. */
  preferredVoiceId: string | null;
  likeness: CastLikeness;
};

const PLACEHOLDER_IMAGE = /picsum\.photos|placehold|placeholder|dummyimage\.com|loremflickr|unsplash\.it|fakeimg/i;

/** Stock / placeholder images are never a likeness (ADR-0006). */
export function isPlaceholderImageUrl(url: string): boolean {
  return PLACEHOLDER_IMAGE.test(url);
}

function realImage(url: unknown): string | null {
  return typeof url === 'string' && url.trim().length > 0 && !isPlaceholderImageUrl(url) ? url.trim() : null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS: RegExp[] = [/\[\[cast:([^\]\s]+)\]\]/g, /\$\$([^$]+)\$\$/g, /\$([a-zA-Z0-9_-]{15,})\$/g];

/** Every cast token id in `text`, in order of first appearance. */
export function extractCastTokens(text: string): string[] {
  const found: Array<{ index: number; id: string }> = [];
  let rest = text ?? '';
  for (const pattern of TOKEN_PATTERNS) {
    rest = rest.replace(pattern, (match, id: string, offset: number) => {
      found.push({ index: offset, id: id.trim() });
      return ' '.repeat(match.length);
    });
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.index - b.index)
    .map((f) => f.id)
    .filter((id) => id.length > 0 && !seen.has(id) && (seen.add(id), true));
}

/** Replace every cast token; `name(id)` returns the replacement or null for an unknown id. */
export function replaceCastTokens(text: string, name: (id: string) => string | null): string {
  let result = text ?? '';
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, (_match, id: string) => name(id.trim()) ?? 'a friend');
  }
  return result;
}

/** ElevenLabs v3 audio directions (`[whispers]`) are for narration only, never displayed. */
export function stripAudioTags(text: string): string {
  return text.replace(/\[([^\]]+)\](?!\()/g, '');
}

function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:])/g, '$1').trim();
}

export type Cast = {
  members: CastEntry[];
  /** token id (document id or legacy display name) → castId */
  tokenMap: Map<string, string>;
  byId: Map<string, CastEntry>;
};

/** The words a child reads: names resolved, no tokens, no audio directions. */
export function displayText(text: string, cast: Cast): string {
  return tidy(stripAudioTags(replaceCastTokens(text, (id) => castFor(cast, id)?.displayName ?? null)));
}

/** What the narrator reads: names as pronounced; audio directions kept (the narrate job drops them if the model cannot use them). */
export function narrationText(text: string, cast: Cast): string {
  return tidy(
    replaceCastTokens(text, (id) => {
      const member = castFor(cast, id);
      return member ? member.namePronunciation || member.displayName : null;
    })
  );
}

export function castFor(cast: Cast, tokenId: string): CastEntry | undefined {
  const castId = cast.tokenMap.get(tokenId) ?? tokenId;
  return cast.byId.get(castId);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type RawEntity = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function ageFrom(dateOfBirth: unknown, now: Date): string | null {
  if (!dateOfBirth) return null;
  const toDate = (dateOfBirth as { toDate?: () => Date }).toDate;
  const dob = typeof toDate === 'function' ? toDate.call(dateOfBirth) : new Date(dateOfBirth as string);
  if (Number.isNaN(dob.getTime())) return null;
  const ms = now.getTime() - dob.getTime();
  if (ms <= 0) return null;
  const years = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
  if (years < 2) return `${Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44))} months old`;
  return `${years} years old`;
}

function isOwned(data: RawEntity | undefined, ownerUid: string): data is RawEntity {
  return !!data && data.ownerParentUid === ownerUid && (data.deletedAt === undefined || data.deletedAt === null);
}

function entryFrom(
  kind: 'child' | 'character',
  id: string,
  data: RawEntity,
  role: CastEntry['role'],
  now: Date
): CastEntry {
  const photos = Array.isArray(data.photos) ? data.photos.map(realImage).filter((u): u is string => !!u) : [];
  return {
    castId: id,
    ref: { kind, id },
    role,
    addedBy: 'setup',
    displayName: str(data.displayName) ?? (kind === 'child' ? 'the child' : 'a friend'),
    pronouns: str(data.pronouns),
    namePronunciation: str(data.namePronunciation),
    description: str(data.description),
    characterType: kind === 'character' ? str(data.type) : null,
    likes: Array.isArray(data.likes) ? data.likes.filter((l): l is string => typeof l === 'string') : [],
    age: kind === 'child' ? ageFrom(data.dateOfBirth, now) : null,
    preferredVoiceId: kind === 'child' ? str(data.preferredVoiceId) : null,
    likeness: {
      portrait: realImage(data.canonicalImageUrl),
      appearance: str(data.imageDescription),
      photos,
    },
  };
}

/**
 * Build the Story's cast: the child (hero) first, then `actors[]`, then any
 * other token found in the text. Ids that are not the owner's children or
 * characters are dropped; legacy name tokens are matched by display name within
 * the owner's family only.
 */
export async function loadCast(db: Firestore, story: StorySource, now: Date = new Date()): Promise<Cast> {
  const ownerUid = story.ownerUid;
  const members: CastEntry[] = [];
  const tokenMap = new Map<string, string>();
  const byId = new Map<string, CastEntry>();
  if (!ownerUid) return { members, tokenMap, byId };

  const candidates = [story.childId, ...story.actorIds, ...extractCastTokens(story.text)].filter(
    (id): id is string => typeof id === 'string' && id.length > 0 && !id.includes('/')
  );
  const unique = [...new Set(candidates)];

  const add = (entry: CastEntry, token: string) => {
    if (!byId.has(entry.castId)) {
      byId.set(entry.castId, entry);
      members.push(entry);
    }
    tokenMap.set(token, entry.castId);
  };

  const unresolved: string[] = [];
  for (const id of unique) {
    const role: CastEntry['role'] = id === story.childId ? 'hero' : 'supporting';
    const childSnap = await db.collection('children').doc(id).get();
    const child = childSnap.data();
    if (childSnap.exists && isOwned(child, ownerUid)) {
      add(entryFrom('child', id, child, role, now), id);
      continue;
    }
    const characterSnap = await db.collection('characters').doc(id).get();
    const character = characterSnap.data();
    if (characterSnap.exists && isOwned(character, ownerUid)) {
      add(entryFrom('character', id, character, role, now), id);
      continue;
    }
    unresolved.push(id);
  }

  // Legacy text used display names as tokens: match them inside this family only.
  for (const name of unresolved) {
    for (const [collection, kind] of [
      ['characters', 'character'],
      ['children', 'child'],
    ] as const) {
      const snapshot = await db
        .collection(collection)
        .where('ownerParentUid', '==', ownerUid)
        .where('displayName', '==', name)
        .limit(1)
        .get();
      const doc = snapshot.docs[0];
      const data = doc?.data();
      if (doc && isOwned(data, ownerUid)) {
        add(entryFrom(kind, doc.id, data, doc.id === story.childId ? 'hero' : 'supporting', now), name);
        break;
      }
    }
  }

  return { members, tokenMap, byId };
}
