/**
 * Reading and writing Children and Characters (slice 6.3: the old fields are
 * gone). Every document was migrated to the target shape (`ownerUid` +
 * `likeness.*`, `scripts/migrate-likeness.mjs`) and the old field names
 * (`ownerParentUid` / `imageDescription` / `canonicalImageUrl` / `avatarUrl` /
 * `avatarAnimationUrl`) were dropped (`scripts/drop-legacy-likeness.mjs`).
 *
 * - `normalize` maps a stored document onto the Child / Character schema.
 * - Placeholder and stock images (picsum and friends) are never a likeness and
 *   never an avatar (ADR-0006): they read as absent.
 * - `likenessWrite` builds the update for a likeness change (`likeness.<field>`).
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
  const avatar = image(target.avatar);
  const source = target.avatarSource;
  return {
    photos: strings(target.photos).filter((p) => !isPlaceholderImageUrl(p)),
    appearance: str(target.appearance),
    portrait: image(target.portrait),
    avatar,
    avatarSource: avatar ? (source === 'portrait' || source === 'description' || source === 'photo' ? source : null) : null,
    avatarAnimation: image(target.avatarAnimation),
    likenessJob: {
      describe: jobSummary(jobs.describe),
      portrait: jobSummary(jobs.portrait),
      avatar: jobSummary(jobs.avatar),
      animate: jobSummary(jobs.animate),
    },
  };
}

export function ownerOf(data: Raw): string | null {
  return str(data.ownerUid);
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

/** A family's children or characters, not deleted. Documents carry `ownerUid` (slice 6.3). */
export async function listOwnedPeople(db: Firestore, kind: PersonKind, ownerUid: string, options: { limit?: number } = {}): Promise<Person[]> {
  const snapshot = await db.collection(COLLECTION_FOR[kind]).where('ownerUid', '==', ownerUid).get();
  const people: Person[] = [];
  for (const doc of snapshot.docs) {
    const person = normalize(kind, doc.id, doc.data());
    if (!person.deleted) people.push(person);
  }
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

/** The update for likeness fields: `likeness.<field>` (`null` clears the field). */
export function likenessWrite(values: Partial<Omit<Likeness, 'likenessJob'>> & { jobs?: Partial<Likeness['likenessJob']> }, now: Stamp = FieldValue.serverTimestamp()): LikenessPatch {
  const patch: LikenessPatch = { updatedAt: now };
  for (const [key, value] of Object.entries(values)) {
    if (key === 'jobs') continue;
    patch[`likeness.${key}`] = value;
  }
  for (const [job, summary] of Object.entries(values.jobs ?? {})) patch[`likeness.likenessJob.${job}`] = summary;
  return patch;
}

export type TimestampLike = Timestamp | null;
export type { AvatarSource };
