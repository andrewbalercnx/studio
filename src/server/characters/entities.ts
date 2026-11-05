/**
 * Reading and writing Children and Characters during the likeness migration
 * (slice 5.7).
 *
 * - `normalize` maps a stored document in either shape (target `likeness.*` +
 *   `ownerUid`, or the old `imageDescription` / `canonicalImageUrl` /
 *   `avatarUrl` / `avatarAnimationUrl` + `ownerParentUid`) onto the
 *   Child / Character schema. The target field wins when both are present.
 * - Placeholder and stock images (picsum and friends) are never a likeness and
 *   never an avatar (ADR-0006): they read as absent.
 * - `likenessWrite` builds the update for a likeness change: the target field,
 *   and while old clients are live, the old field they read (`MIRROR_LEGACY`).
 *   5.7b's cleanup turns the mirror off.
 */
import { createHash } from 'node:crypto';
import { FieldValue, type DocumentSnapshot, type Firestore, type Timestamp } from 'firebase-admin/firestore';
import {
  characterSchema,
  childSchema,
  COLLECTION_FOR,
  type Character,
  type Child,
  type PersonKind,
} from '../data/schemas/people';
import type { AvatarSource, Likeness } from '../data/schemas/likeness';
import type { JobSummary } from '../data/schemas/common';

const PLACEHOLDER_IMAGE = /picsum\.photos|placehold|placeholder|dummyimage\.com|loremflickr|unsplash\.it|fakeimg/i;

/** Stock / placeholder images are never a likeness or an avatar (ADR-0006). */
export function isPlaceholderImageUrl(url: string): boolean {
  return PLACEHOLDER_IMAGE.test(url);
}

/** Old clients read these fields until 5.7b ships; jobs mirror into them meanwhile. */
export const MIRROR_LEGACY = true;

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function image(value: unknown): string | null {
  const url = str(value);
  return url && !isPlaceholderImageUrl(url) ? url : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  const toDate = (value as { toDate?: () => Date }).toDate;
  const date = typeof toDate === 'function' ? toDate.call(value) : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function jobSummary(value: unknown): JobSummary | null {
  const v = value as { jobId?: unknown; status?: unknown } | null | undefined;
  return v && typeof v.jobId === 'string' && typeof v.status === 'string' ? (v as JobSummary) : null;
}

/** The likeness of a stored document, whichever shape it is in. */
export function readLikeness(data: Raw): Likeness {
  const target = (data.likeness ?? {}) as Raw;
  const jobs = (target.likenessJob ?? {}) as Raw;
  const photos = strings(target.photos).length ? strings(target.photos) : strings(data.photos);
  const avatar = image(target.avatar) ?? image(data.avatarUrl);
  const source = target.avatarSource;
  return {
    photos: photos.filter((p) => !isPlaceholderImageUrl(p)),
    appearance: str(target.appearance) ?? str(data.imageDescription),
    portrait: image(target.portrait) ?? image(data.canonicalImageUrl),
    avatar,
    avatarSource: avatar ? (source === 'portrait' || source === 'description' || source === 'photo' ? source : null) : null,
    avatarAnimation: image(target.avatarAnimation) ?? image(data.avatarAnimationUrl),
    likenessJob: {
      describe: jobSummary(jobs.describe),
      portrait: jobSummary(jobs.portrait),
      avatar: jobSummary(jobs.avatar),
      animate: jobSummary(jobs.animate),
    },
  };
}

export function ownerOf(data: Raw): string | null {
  return str(data.ownerUid) ?? str(data.ownerParentUid);
}

function isDeleted(data: Raw): boolean {
  return data.deletedAt !== undefined && data.deletedAt !== null;
}

function profile(data: Raw, fallbackName: string) {
  return {
    ownerUid: ownerOf(data) ?? '',
    displayName: str(data.displayName) ?? fallbackName,
    namePronunciation: str(data.namePronunciation),
    pronouns: str(data.pronouns),
    description: str(data.description),
    likes: strings(data.likes),
    dislikes: strings(data.dislikes),
    dateOfBirth: dateString(data.dateOfBirth),
    likeness: readLikeness(data),
    deleted: isDeleted(data),
  };
}

export function normalizeChild(data: Raw): Child {
  return childSchema.parse({
    ...profile(data, 'the child'),
    preferredVoiceId: str(data.preferredVoiceId),
    autoReadAloud: data.autoReadAloud !== false,
  });
}

export function normalizeCharacter(data: Raw): Character {
  return characterSchema.parse({
    ...profile(data, 'a friend'),
    type: str(data.type),
    relationship: str(data.relationship),
    childId: str(data.childId),
    origin: data.origin === 'story' ? 'story' : 'parent',
    originStoryId: str(data.originStoryId),
    usageCount: typeof data.usageCount === 'number' && data.usageCount >= 0 ? Math.floor(data.usageCount) : 0,
  });
}

export type Person = (Child & { kind: 'child'; id: string }) | (Character & { kind: 'character'; id: string });

export function normalize(kind: PersonKind, id: string, data: Raw): Person {
  return kind === 'child' ? { kind, id, ...normalizeChild(data) } : { kind, id, ...normalizeCharacter(data) };
}

export async function readPerson(db: Firestore, kind: PersonKind, id: string): Promise<Person | null> {
  const snapshot: DocumentSnapshot = await db.collection(COLLECTION_FOR[kind]).doc(id).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  if (!ownerOf(data)) return null;
  return normalize(kind, id, data);
}

/**
 * A family's children or characters, not deleted, in either shape. Documents carry
 * `ownerParentUid` until the migration and `ownerUid` after it (both, for new ones), so
 * both are queried and the results merged.
 */
export async function listOwnedPeople(db: Firestore, kind: PersonKind, ownerUid: string, options: { limit?: number } = {}): Promise<Person[]> {
  const collection = db.collection(COLLECTION_FOR[kind]);
  const [legacy, target] = await Promise.all([
    collection.where('ownerParentUid', '==', ownerUid).get(),
    collection.where('ownerUid', '==', ownerUid).get(),
  ]);
  const byId = new Map<string, Person>();
  for (const doc of [...legacy.docs, ...target.docs]) {
    if (byId.has(doc.id)) continue;
    const person = normalize(kind, doc.id, doc.data());
    if (!person.deleted) byId.set(doc.id, person);
  }
  const people = [...byId.values()];
  return options.limit ? people.slice(0, options.limit) : people;
}

/** The persona scope key of a person: a child is its own scope; a character its `childId` (or none). */
export function personaChildId(person: Person): string | null {
  return person.kind === 'child' ? person.id : person.childId;
}

/** Stable key of a photo set, so a likeness job can tell its inputs are still current. */
export function photosKey(photos: string[]): string {
  return createHash('sha256').update([...photos].sort().join('\n')).digest('hex').slice(0, 16);
}

export function photoIdOf(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12);
}

export function textKey(text: string | null): string {
  return createHash('sha256').update(text ?? '').digest('hex').slice(0, 16);
}

type Stamp = ReturnType<typeof FieldValue.serverTimestamp>;
export type LikenessPatch = Record<string, unknown>;

const LEGACY_FIELD: Partial<Record<keyof Likeness, string>> = {
  appearance: 'imageDescription',
  portrait: 'canonicalImageUrl',
  avatar: 'avatarUrl',
  avatarAnimation: 'avatarAnimationUrl',
  photos: 'photos',
};

/**
 * The update for likeness fields: `likeness.<field>` and, while
 * `MIRROR_LEGACY`, the old field old clients read. `null` clears the field.
 */
export function likenessWrite(values: Partial<Omit<Likeness, 'likenessJob'>> & { jobs?: Partial<Likeness['likenessJob']> }, now: Stamp = FieldValue.serverTimestamp()): LikenessPatch {
  const patch: LikenessPatch = { updatedAt: now };
  for (const [key, value] of Object.entries(values)) {
    if (key === 'jobs') continue;
    patch[`likeness.${key}`] = value;
    const legacy = LEGACY_FIELD[key as keyof Likeness];
    if (MIRROR_LEGACY && legacy) patch[legacy] = value === null ? FieldValue.delete() : value;
  }
  for (const [job, summary] of Object.entries(values.jobs ?? {})) patch[`likeness.likenessJob.${job}`] = summary;
  return patch;
}

export type TimestampLike = Timestamp | null;
export type { AvatarSource };
