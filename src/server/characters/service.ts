/**
 * Children and Characters behind the routes (slice 5.7a). Every change and the
 * likeness jobs it needs are written in one transaction; jobs are dispatched
 * after the commit; files are deleted after it.
 *
 * Documents are in the target shape only (`ownerUid` + `likeness.*`); the old
 * field names were dropped in slice 6.3 (`entities.ts` `likenessWrite`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { BlobStore } from '../books/media';
import { storagePathOfUrl } from '../books/media';
import { COLLECTION_FOR, editableCharacterSchema, editableChildSchema, type PersonKind } from '../data/schemas/people';
import { BadRequestError, ConflictError, NotFoundError } from '../errors';
import { assertOwner, isPrivileged, type VerifiedUser } from '../http';
import type { JobRunner, JobSpec } from '../jobs';
import { likenessWrite, listOwnedPeople, normalize, ownerOf, personaChildId, photoIdOf, readLikeness, type Person } from './entities';
import { avatarSpec, likenessSpecs } from './likeness-jobs';

export type PeopleDeps = {
  db: Firestore;
  runner: Pick<JobRunner, 'enqueueInTransaction'>;
  blobs: BlobStore;
  now: () => Date;
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 10;
const LABEL: Record<PersonKind, string> = { child: 'Child', character: 'Character' };

type Raw = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type PersonView = Omit<Person, 'deleted'> & {
  /** Avatar drawn from the words, not a photo: the UI labels it "imagined". */
  avatarImagined: boolean;
  /** Each part's progress, so the editor can show them separately. */
  likenessStatus: Record<'describe' | 'portrait' | 'avatar' | 'animate', 'idle' | 'working' | 'failed'>;
  photoIds: Array<{ id: string; url: string }>;
};

function statusOf(summary: { status: string } | null): 'idle' | 'working' | 'failed' {
  if (!summary) return 'idle';
  if (summary.status === 'failed' || summary.status === 'cancelled') return 'failed';
  return summary.status === 'succeeded' ? 'idle' : 'working';
}

export function viewOf(person: Person): PersonView {
  const { deleted: _deleted, ...rest } = person;
  const jobs = person.likeness.likenessJob;
  return {
    ...rest,
    avatarImagined: person.likeness.avatarSource === 'description',
    likenessStatus: { describe: statusOf(jobs.describe), portrait: statusOf(jobs.portrait), avatar: statusOf(jobs.avatar), animate: statusOf(jobs.animate) },
    photoIds: person.likeness.photos.map((url) => ({ id: photoIdOf(url), url })),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadOwnedRaw(db: Firestore, user: VerifiedUser, kind: PersonKind, id: string, options: { includeDeleted?: boolean } = {}): Promise<{ person: Person; raw: Raw }> {
  if (!id) throw new BadRequestError(`Missing ${LABEL[kind].toLowerCase()} id`);
  const snapshot = await db.collection(COLLECTION_FOR[kind]).doc(id).get();
  const raw = snapshot.data();
  if (!snapshot.exists || !raw || !ownerOf(raw)) throw new NotFoundError(`${LABEL[kind]} not found`, { code: `${kind.toUpperCase()}_NOT_FOUND` });
  const person = normalize(kind, id, raw);
  if (person.deleted && !options.includeDeleted) throw new NotFoundError(`${LABEL[kind]} not found`, { code: `${kind.toUpperCase()}_NOT_FOUND` });
  await assertOwner(user, { ownerUid: person.ownerUid, childId: personaChildId(person) }, LABEL[kind]);
  return { person, raw };
}

/** The help-tour samples (`help-*`), readable by any signed-in user as the rules allow; never writable. */
export function isHelpId(id: string): boolean {
  return id.startsWith('help-');
}

export async function getPerson(db: Firestore, user: VerifiedUser, kind: PersonKind, id: string): Promise<PersonView> {
  if (isHelpId(id)) {
    const snapshot = await db.collection(COLLECTION_FOR[kind]).doc(id).get();
    if (!snapshot.exists) throw new NotFoundError(`${LABEL[kind]} not found`, { code: `${kind.toUpperCase()}_NOT_FOUND` });
    return viewOf(normalize(kind, id, snapshot.data() ?? {}));
  }
  return viewOf((await loadOwnedRaw(db, user, kind, id)).person);
}

/**
 * The family's children or characters (not deleted), by name. Characters can be narrowed to those a child may use.
 * `includeHelp` appends the help-tour sample (`help-character`), which the help wizards point at.
 */
export async function listPeople(
  db: Firestore,
  user: VerifiedUser,
  kind: PersonKind,
  filter: { childId?: string | null; includeHelp?: boolean } = {}
): Promise<PersonView[]> {
  const collection = db.collection(COLLECTION_FOR[kind]);
  const owned = await listOwnedPeople(db, kind, user.uid);
  const byId = new Map(owned.map((p) => [p.id, p] as const));
  let people = [...byId.values()];
  if (kind === 'character' && filter.childId) people = people.filter((p) => p.kind === 'character' && (!p.childId || p.childId === filter.childId));
  people.sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (filter.includeHelp) {
    const helpId = kind === 'child' ? 'help-child' : 'help-character';
    const help = await collection.doc(helpId).get();
    if (help.exists && !byId.has(helpId)) people.push(normalize(kind, helpId, help.data() ?? {}));
  }
  return people.map(viewOf);
}

/** Admin: one family's children or characters (not deleted), by name. */
export async function listPeopleOf(db: Firestore, kind: PersonKind, ownerUid: string): Promise<PersonView[]> {
  const people = await listOwnedPeople(db, kind, ownerUid);
  return people.sort((a, b) => a.displayName.localeCompare(b.displayName)).map(viewOf);
}

/**
 * The shape `GET /api/children[/{id}]` answered before 5.7 (a bare array /
 * object of the stored fields), which the mobile app reads: kept, with the
 * normalised `likeness` added.
 */
export async function legacyChildrenResponse(db: Firestore, user: VerifiedUser, childId?: string): Promise<NextResponse> {
  if (childId) {
    const { person, raw } = await loadOwnedRaw(db, user, 'child', childId);
    return NextResponse.json({ id: childId, ...raw, likeness: person.likeness });
  }
  const views = await listPeople(db, user, 'child');
  const raws = await Promise.all(views.map((v) => db.collection('children').doc(v.id).get()));
  return NextResponse.json(raws.map((snap, i) => ({ id: snap.id, ...snap.data(), likeness: views[i].likeness })));
}

// ---------------------------------------------------------------------------
// Create, edit, delete
// ---------------------------------------------------------------------------

type ChildInput = Partial<z.infer<typeof editableChildSchema>> & { displayName: string };
type CharacterInput = Partial<z.infer<typeof editableCharacterSchema>> & { displayName: string };

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 20);
}

export function personIdFor(kind: PersonKind, ownerUid: string, idempotencyKey: string): string {
  return `${kind === 'child' ? 'ch' : 'chr'}_${sha(`${kind}|${ownerUid}|${idempotencyKey}`)}`;
}

function profileWrite(input: Partial<ChildInput & CharacterInput>): Raw {
  const out: Raw = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = key === 'dateOfBirth' && typeof value === 'string' ? Timestamp.fromDate(new Date(`${value}T00:00:00Z`)) : value;
  }
  return out;
}

type Plan = { specs: JobSpec[]; apply?: () => void };

const PART_OF_KIND: Record<string, 'describe' | 'portrait' | 'avatar' | 'animate'> = {
  'likeness.describe': 'describe',
  'likeness.portrait': 'portrait',
  'likeness.avatar': 'avatar',
  'likeness.animate': 'animate',
};

/**
 * `work` does its reads and returns the jobs and the writes; the jobs are
 * enqueued (which reads the job documents) before the writes are applied, as
 * Firestore transactions need all reads first.
 */
async function commitWithJobs(deps: PeopleDeps, work: (tx: Transaction) => Promise<Plan>): Promise<void> {
  const pending = await deps.db.runTransaction(async (tx) => {
    const plan = await work(tx);
    const queued = plan.specs.length ? await deps.runner.enqueueInTransaction(tx, plan.specs) : null;
    plan.apply?.();
    // Show each queued part as working at once (the job overwrites it when it runs).
    queued?.jobs.forEach((job, i) => {
      const spec = plan.specs[i];
      const part = PART_OF_KIND[spec.kind];
      if (!part || !job.created) return;
      tx.update(deps.db.collection(spec.target.collection).doc(spec.target.id), { [`likeness.likenessJob.${part}`]: { jobId: job.jobId, status: 'queued' } });
    });
    return queued;
  });
  if (pending) await pending.dispatch();
}

/** Create a child or character. With no photos yet, an "imagined" avatar is drawn from the words. Same key → same record. */
export async function createPerson(
  deps: PeopleDeps,
  user: VerifiedUser,
  kind: PersonKind,
  body: (ChildInput | CharacterInput) & { idempotencyKey: string }
): Promise<PersonView> {
  const { idempotencyKey, ...fields } = body;
  const parsed = (kind === 'child' ? editableChildSchema : editableCharacterSchema).partial().parse(fields);
  if (!parsed.displayName) throw new BadRequestError('A name is needed', { code: 'NAME_REQUIRED' });
  const id = personIdFor(kind, user.uid, idempotencyKey);
  const ref = deps.db.collection(COLLECTION_FOR[kind]).doc(id);
  if (kind === 'character' && (parsed as CharacterInput).childId) {
    await loadOwnedRaw(deps.db, user, 'child', (parsed as CharacterInput).childId!);
  }
  await commitWithJobs(deps, async (tx) => {
    if ((await tx.get(ref)).exists) return { specs: [] };
    const now = FieldValue.serverTimestamp();
    const apply = () => tx.create(ref, {
      id,
      ownerUid: user.uid,
      ...profileWrite(parsed),
      likes: (parsed as ChildInput).likes ?? [],
      dislikes: (parsed as ChildInput).dislikes ?? [],
      ...(kind === 'character' ? { origin: 'parent', isParentGenerated: true, usageCount: 0 } : {}),
      photos: [],
      likeness: { photos: [], appearance: null, portrait: null, avatar: null, avatarSource: null, avatarAnimation: null, likenessJob: {} },
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    return { specs: [avatarSpec({ kind, id, ownerUid: user.uid }, 'description', (parsed as ChildInput).description ?? null)], apply };
  });
  return getPerson(deps.db, user, kind, id);
}

/** Edit profile fields (allowlist). A changed description redraws an "imagined" avatar. */
export async function updatePerson(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string, patch: Partial<ChildInput & CharacterInput>): Promise<PersonView> {
  const parsed = (kind === 'child' ? editableChildSchema : editableCharacterSchema).partial().parse(patch);
  if (Object.keys(parsed).length === 0) throw new BadRequestError('Nothing to change', { code: 'EMPTY_PATCH' });
  const { person } = await loadOwnedRaw(deps.db, user, kind, id);
  if (kind === 'character' && (parsed as CharacterInput).childId) await loadOwnedRaw(deps.db, user, 'child', (parsed as CharacterInput).childId!);
  const ref = deps.db.collection(COLLECTION_FOR[kind]).doc(id);
  await commitWithJobs(deps, async (tx) => {
    const newDescription = (parsed as ChildInput).description;
    const redraw = newDescription !== undefined && newDescription !== person.description && person.likeness.avatarSource !== 'photo' && person.likeness.avatarSource !== 'portrait';
    return {
      specs: redraw ? [avatarSpec({ kind, id, ownerUid: person.ownerUid }, 'description', newDescription ?? null)] : [],
      apply: () => tx.update(ref, { ...profileWrite(parsed), updatedAt: FieldValue.serverTimestamp() }),
    };
  });
  return getPerson(deps.db, user, kind, id);
}

/** Soft delete (undo with `restorePerson`). */
export async function deletePerson(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string): Promise<{ id: string; deleted: true }> {
  await loadOwnedRaw(deps.db, user, kind, id);
  await deps.db.collection(COLLECTION_FOR[kind]).doc(id).update({ deletedAt: FieldValue.serverTimestamp(), deletedBy: user.uid, updatedAt: FieldValue.serverTimestamp() });
  return { id, deleted: true };
}

export async function restorePerson(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string): Promise<PersonView> {
  await loadOwnedRaw(deps.db, user, kind, id, { includeDeleted: true });
  await deps.db.collection(COLLECTION_FOR[kind]).doc(id).update({ deletedAt: null, deletedBy: null, updatedAt: FieldValue.serverTimestamp() });
  return getPerson(deps.db, user, kind, id);
}

// ---------------------------------------------------------------------------
// Photos and likeness
// ---------------------------------------------------------------------------

function parseDataUrl(dataUrl: string): { contentType: string; data: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) throw new BadRequestError('The photo is not a data URL', { code: 'INVALID_PHOTO' });
  const contentType = match[1];
  if (!contentType.startsWith('image/')) throw new BadRequestError('Only images can be uploaded', { code: 'INVALID_PHOTO' });
  const data = Buffer.from(match[2], 'base64');
  if (data.length === 0) throw new BadRequestError('The photo is empty', { code: 'INVALID_PHOTO' });
  if (data.length > MAX_UPLOAD_BYTES) throw new BadRequestError('The photo is larger than 8 MB', { code: 'PHOTO_TOO_LARGE', details: { maxBytes: MAX_UPLOAD_BYTES } });
  return { contentType, data };
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif' };

/** Add an original photo and update `photos` in one step; the appearance and portrait are redone from the new set. */
export async function addPhoto(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string, body: { dataUrl: string }): Promise<PersonView> {
  const { person } = await loadOwnedRaw(deps.db, user, kind, id);
  if (person.likeness.photos.length >= MAX_PHOTOS) throw new ConflictError(`At most ${MAX_PHOTOS} photos`, { code: 'TOO_MANY_PHOTOS' });
  const { contentType, data } = parseDataUrl(body.dataUrl);
  const stored = await deps.blobs.save(
    `users/${person.ownerUid}/${COLLECTION_FOR[kind]}/${id}/photos/${deps.now().getTime()}_${randomUUID().slice(0, 8)}.${EXTENSIONS[contentType] ?? 'img'}`,
    data,
    contentType,
    { ownerUid: person.ownerUid, uploadedBy: user.uid }
  );
  const ref = deps.db.collection(COLLECTION_FOR[kind]).doc(id);
  await commitWithJobs(deps, async (tx) => {
    const current = normalize(kind, id, (await tx.get(ref)).data() ?? {});
    const photos = [...current.likeness.photos, stored.url];
    return {
      specs: likenessSpecs({ kind, id, ownerUid: current.ownerUid }, photos),
      apply: () => tx.update(ref, likenessWrite({ photos }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>),
    };
  });
  return getPerson(deps.db, user, kind, id);
}

/** Remove a photo: delete the file and redo the appearance and portrait from the rest (cleared when none are left). */
export async function removePhoto(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string, photoId: string): Promise<PersonView> {
  await loadOwnedRaw(deps.db, user, kind, id);
  const ref = deps.db.collection(COLLECTION_FOR[kind]).doc(id);
  let removed: string | null = null;
  await commitWithJobs(deps, async (tx) => {
    const current = normalize(kind, id, (await tx.get(ref)).data() ?? {});
    removed = current.likeness.photos.find((url) => photoIdOf(url) === photoId) ?? null;
    if (!removed) throw new NotFoundError('Photo not found', { code: 'PHOTO_NOT_FOUND' });
    const photos = current.likeness.photos.filter((url) => url !== removed);
    const usedAsAvatar = current.likeness.avatarSource === 'photo' && current.likeness.avatar === removed;
    const owner = { kind, id, ownerUid: current.ownerUid };
    return {
      specs: [...likenessSpecs(owner, photos), ...(usedAsAvatar && photos.length === 0 ? [avatarSpec(owner, 'description', current.description)] : [])],
      apply: () => tx.update(ref, likenessWrite({ photos, ...(usedAsAvatar ? { avatar: null, avatarSource: null } : {}) }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>),
    };
  });
  const path = removed ? storagePathOfUrl(removed) : null;
  if (path && deps.blobs.delete) await deps.blobs.delete(path).catch((error) => console.warn('[people] Could not delete photo file', path, (error as Error)?.message));
  return getPerson(deps.db, user, kind, id);
}

/** Run the appearance and portrait again from the current photos. */
export async function refreshLikeness(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string): Promise<PersonView> {
  const { person } = await loadOwnedRaw(deps.db, user, kind, id);
  await commitWithJobs(deps, async () => ({ specs: likenessSpecs(person, person.likeness.photos, `refresh-${deps.now().getTime()}`) }));
  return getPerson(deps.db, user, kind, id);
}

export type BackfillTarget = { kind: PersonKind; id: string };
export type BackfillLikenessResult = {
  scanned: number;
  enqueued: Array<{ kind: PersonKind; id: string; photos: number }>;
  skipped: Array<{ kind: PersonKind; id: string; reason: string }>;
};

/**
 * System-level likeness backfill (no user). Enqueues `likeness.describe` +
 * `likeness.portrait` for persons that have photos but are missing the generated
 * `appearance` or `portrait` — the pre-pipeline profiles the per-photo trigger
 * never ran for, whose illustrations drift for want of an identity anchor.
 *
 * Internal use only (secret-protected route). It acts as the system, never as a
 * parent: ownership comes from each document's own `ownerUid`, so it is not a
 * user impersonation path. Jobs dispatch through the normal runner after commit.
 */
export async function backfillLikeness(
  deps: PeopleDeps,
  input: { targets?: BackfillTarget[]; scanMissing?: boolean },
): Promise<BackfillLikenessResult> {
  const nonce = `backfill-${deps.now().getTime()}`;
  const enqueue: Array<{ kind: PersonKind; id: string; ownerUid: string; photos: string[] }> = [];
  const skipped: BackfillLikenessResult['skipped'] = [];
  let scanned = 0;

  const isDeleted = (data: FirebaseFirestore.DocumentData) => data.deletedAt !== undefined && data.deletedAt !== null;
  const consider = (kind: PersonKind, id: string, data: FirebaseFirestore.DocumentData) => {
    if (isDeleted(data)) return skipped.push({ kind, id, reason: 'deleted' });
    const ownerUid = ownerOf(data);
    if (!ownerUid) return skipped.push({ kind, id, reason: 'no ownerUid' });
    const likeness = readLikeness(data);
    if (!likeness.photos.length) return skipped.push({ kind, id, reason: 'no photos' });
    enqueue.push({ kind, id, ownerUid, photos: likeness.photos });
  };

  if (input.scanMissing) {
    for (const kind of ['child', 'character'] as PersonKind[]) {
      const snapshot = await deps.db.collection(COLLECTION_FOR[kind]).get();
      for (const doc of snapshot.docs) {
        scanned += 1;
        const data = doc.data();
        if (isDeleted(data)) continue;
        const likeness = readLikeness(data);
        if (likeness.photos.length && (!likeness.appearance || !likeness.portrait)) consider(kind, doc.id, data);
      }
    }
  }

  for (const target of input.targets ?? []) {
    if (enqueue.some((e) => e.kind === target.kind && e.id === target.id)) continue;
    const snapshot = await deps.db.collection(COLLECTION_FOR[target.kind]).doc(target.id).get();
    scanned += 1;
    if (!snapshot.exists) {
      skipped.push({ kind: target.kind, id: target.id, reason: 'not found' });
      continue;
    }
    consider(target.kind, target.id, snapshot.data()!);
  }

  const specs = enqueue.flatMap((p) => likenessSpecs({ kind: p.kind, id: p.id, ownerUid: p.ownerUid }, p.photos, nonce));
  if (specs.length) await commitWithJobs(deps, async () => ({ specs }));
  return {
    scanned,
    enqueued: enqueue.map((p) => ({ kind: p.kind, id: p.id, photos: p.photos.length })),
    skipped,
  };
}

/**
 * A new avatar: drawn from the portrait, drawn from the words ("imagined"), or
 * one of the photos used as it is (`photo`). UI only in every case.
 */
export async function setAvatar(deps: PeopleDeps, user: VerifiedUser, kind: PersonKind, id: string, body: { source: 'portrait' | 'description' | 'photo'; photoId?: string }): Promise<PersonView> {
  const { person } = await loadOwnedRaw(deps.db, user, kind, id);
  const ref = deps.db.collection(COLLECTION_FOR[kind]).doc(id);
  if (body.source === 'photo') {
    const url = person.likeness.photos.find((p) => photoIdOf(p) === body.photoId);
    if (!url) throw new NotFoundError('Photo not found', { code: 'PHOTO_NOT_FOUND' });
    await ref.update(likenessWrite({ avatar: url, avatarSource: 'photo' }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
  } else {
    if (body.source === 'portrait' && !person.likeness.portrait) throw new ConflictError('There is no portrait yet: add a photo first', { code: 'NO_PORTRAIT' });
    // Choosing to draw again clears a chosen photo, so the drawn avatar may replace it.
    await commitWithJobs(deps, async (tx) => {
      return {
        specs: [avatarSpec(person, body.source as 'portrait' | 'description', body.source === 'portrait' ? person.likeness.portrait : person.description, `new-${deps.now().getTime()}`)],
        apply: () => {
          if (person.likeness.avatarSource === 'photo') tx.update(ref, { 'likeness.avatarSource': null, updatedAt: FieldValue.serverTimestamp() });
        },
      };
    });
  }
  return getPerson(deps.db, user, kind, id);
}

/** Admin: move a child or character to another family (slice 6.3: `ownerUid` only). */
export async function reassignOwner(deps: PeopleDeps, admin: VerifiedUser, kind: PersonKind, id: string, ownerUid: string): Promise<PersonView> {
  if (!isPrivileged(admin)) throw new BadRequestError('Admins only');
  const ref = deps.db.collection(COLLECTION_FOR[kind]).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new NotFoundError(`${LABEL[kind]} not found`);
  await ref.update({ ownerUid, updatedAt: FieldValue.serverTimestamp() });
  return viewOf(normalize(kind, id, (await ref.get()).data() ?? {}));
}
