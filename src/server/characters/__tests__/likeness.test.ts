import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforcePersonaScope = vi.fn();
vi.mock('@/lib/persona.server', () => ({
  enforcePersonaScope: (...args: unknown[]) => enforcePersonaScope(...args),
}));

import type { Firestore } from 'firebase-admin/firestore';
import { InProcessDispatcher } from '../../jobs/dispatcher';
import { JobRegistry } from '../../jobs/registry';
import { JobRunner } from '../../jobs/runner';
import { jobs } from '../../data/repositories';
import { FakeFirestore } from '../../testing/fake-firestore';
import type { VerifiedUser } from '../../http/auth';
import { normalize, photoIdOf, readLikeness } from '../entities';
import { describePrompt, portraitPrompt, registerLikenessJobs, type LikenessJobDeps } from '../likeness-jobs';
import { addPhoto, createPerson, getPerson, legacyChildrenResponse, listPeople, removePhoto, setAvatar, updatePerson, type PeopleDeps } from '../service';
import { migrationPatch } from '../../../../scripts/migrate-likeness.mjs';
import { dropPlan, LEGACY_FIELDS } from '../../../../scripts/drop-legacy-likeness.mjs';

const user = (uid: string): VerifiedUser => ({ uid, email: `${uid}@test.local`, claims: { uid } as unknown as VerifiedUser['claims'] });
const p1 = user('p1');
const p2 = user('p2');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('reading either shape', () => {
  it('reads the likeness shape, ignores the old fields, and drops placeholders', () => {
    expect(
      readLikeness({
        likeness: {
          photos: ['https://img/1.jpg', 'https://picsum.photos/seed/x/1'],
          appearance: 'Curly brown hair.',
          portrait: 'https://img/portrait.png',
          avatar: 'https://picsum.photos/seed/a/200',
        },
      })
    ).toMatchObject({ photos: ['https://img/1.jpg'], appearance: 'Curly brown hair.', portrait: 'https://img/portrait.png', avatar: null, avatarSource: null });
    // The old top-level fields are no longer read (slice 6.3).
    expect(readLikeness({ imageDescription: 'old', canonicalImageUrl: 'https://img/x.png', avatarUrl: 'https://img/a.png' })).toMatchObject({
      appearance: null,
      portrait: null,
      avatar: null,
    });
    const child = normalize('child', 'c1', { ownerUid: 'p1', displayName: 'Emma', dateOfBirth: '2020-03-04T00:00:00Z', deletedAt: null });
    expect(child).toMatchObject({ ownerUid: 'p1', displayName: 'Emma', dateOfBirth: '2020-03-04', deleted: false, autoReadAloud: true });
  });

  it('migrates the old fields once (the script)', () => {
    const patch = migrationPatch({
      ownerParentUid: 'p1',
      photos: ['https://img/1.jpg'],
      imageDescription: 'Brown hair.',
      canonicalImageUrl: 'https://img/p.png',
      avatarUrl: 'https://picsum.photos/seed/a/200',
      avatarAnimationUrl: 'https://img/dance.mp4',
    });
    expect(patch).toEqual({
      ownerUid: 'p1',
      likeness: { photos: ['https://img/1.jpg'], appearance: 'Brown hair.', portrait: 'https://img/p.png', avatar: null, avatarSource: null, avatarAnimation: 'https://img/dance.mp4', likenessJob: {} },
    });
    expect(migrationPatch({ ownerParentUid: 'p1', ownerUid: 'p1', ...patch })).toBeNull();
  });

  it('drops the old fields of a migrated document (the drop script)', () => {
    const plan = dropPlan({
      ownerUid: 'p1',
      ownerParentUid: 'p1',
      imageDescription: 'Brown hair.',
      canonicalImageUrl: 'https://img/p.png',
      avatarUrl: 'https://img/a.png',
      avatarAnimationUrl: 'https://img/dance.mp4',
      likeness: { avatar: 'https://img/a.png' },
      likenessMigratedAt: new Date(),
    });
    expect(plan.blocked).toBe(false);
    expect(plan.fields.sort()).toEqual(['avatarAnimationUrl', 'avatarUrl', 'canonicalImageUrl', 'imageDescription', 'ownerParentUid'].sort());
  });

  it('refuses a document that still has old fields but was never migrated', () => {
    const plan = dropPlan({ ownerParentUid: 'p1', avatarUrl: 'https://img/a.png' });
    expect(plan.blocked).toBe(true);
    expect(plan.fields).toContain('avatarUrl');
  });

  it('leaves a clean document alone (nothing to drop)', () => {
    const plan = dropPlan({ ownerUid: 'p1', likeness: { avatar: null }, likenessMigratedAt: new Date() });
    expect(plan).toEqual({ fields: [], blocked: false });
  });

  it('keeps `photos` (it mirrors likeness.photos and is still read)', () => {
    expect(LEGACY_FIELDS).not.toContain('photos');
  });
});

describe('people service and likeness jobs', () => {
  let db: Firestore;
  let dispatcher: InProcessDispatcher;
  let deps: PeopleDeps;
  let ai: { generateText: ReturnType<typeof vi.fn>; generateImage: ReturnType<typeof vi.fn>; call: ReturnType<typeof vi.fn> };
  let deleted: string[];
  let clock = 1_000;

  beforeEach(() => {
    enforcePersonaScope.mockReset();
    enforcePersonaScope.mockResolvedValue({ ok: true, persona: null });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db = new FakeFirestore(() => Date.now()).asFirestore();
    dispatcher = new InProcessDispatcher({ sleep: async () => undefined });
    deleted = [];
    ai = {
      generateText: vi.fn(async () => ({ text: 'Curly brown hair and blue eyes.', output: null, model: {}, usage: null, attempts: 1 })),
      generateImage: vi.fn(async () => ({ mediaUrl: PNG, text: '', model: {}, attempts: 1 })),
      call: vi.fn(async () => ({ result: { bytes: Buffer.from('mp4'), contentType: 'video/mp4', generatedWith: 'fake' }, model: {}, attempts: 1 })),
    };
    const blobs = {
      save: async (storagePath: string) => ({ storagePath, url: `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(storagePath)}?alt=media&token=t` }),
      delete: async (storagePath: string) => void deleted.push(storagePath),
    };
    const jobDeps: LikenessJobDeps = {
      ai: ai as unknown as LikenessJobDeps['ai'],
      blobs,
      fetchImage: async (url) => `data:image/png;base64,${Buffer.from(url).toString('base64')}`,
      testMode: () => false,
      env: {},
    };
    const registry = registerLikenessJobs(new JobRegistry(), async () => jobDeps);
    const runner = new JobRunner({ registry, dispatcher, db, retryDelayMs: () => 0 });
    clock = 1_000;
    deps = { db, runner, blobs, now: () => new Date(clock++) };
  });

  const drain = () => dispatcher.drain();
  const raw = async (collection: string, id: string) => (await db.collection(collection).doc(id).get()).data() as Record<string, unknown>;

  it('creates a child with an "imagined" avatar, then animates it', async () => {
    const child = await createPerson(deps, p1, 'child', { displayName: 'Emma', description: 'Loves dinosaurs', idempotencyKey: 'create-emma-1' });
    expect(child).toMatchObject({ kind: 'child', ownerUid: 'p1', displayName: 'Emma', likenessStatus: { avatar: 'working' } });
    await drain();
    const view = await getPerson(db, p1, 'child', child.id);
    expect(view.likeness).toMatchObject({ avatarSource: 'description', avatarAnimation: expect.stringContaining('animation%2F') });
    expect(view.avatarImagined).toBe(true);
    expect(ai.generateImage.mock.calls[0][0]).toMatchObject({ purpose: 'likeness.avatar' });
    expect(JSON.stringify(ai.generateImage.mock.calls[0][0].prompt)).toContain('Loves dinosaurs');
    // Slice 6.3: only the target shape is written — no legacy mirror.
    const stored = await raw('children', child.id);
    expect((stored.likeness as { avatar?: string }).avatar).toBe(view.likeness.avatar);
    expect(stored.ownerUid).toBe('p1');
    expect(stored.avatarUrl).toBeUndefined();
    expect(stored.ownerParentUid).toBeUndefined();
    // Same key → same child.
    expect((await createPerson(deps, p1, 'child', { displayName: 'Emma', idempotencyKey: 'create-emma-1' })).id).toBe(child.id);
  });

  it('adds a photo in one step and draws appearance and portrait from the photos only, then the avatar from the portrait', async () => {
    const child = await createPerson(deps, p1, 'child', { displayName: 'Emma', idempotencyKey: 'create-emma-2' });
    await drain();
    ai.generateImage.mockClear();
    const withPhoto = await addPhoto(deps, p1, 'child', child.id, { dataUrl: PNG });
    expect(withPhoto.likeness.photos).toHaveLength(1);
    expect(((await raw('children', child.id)).likeness as { photos?: string[] }).photos).toEqual(withPhoto.likeness.photos);
    await drain();

    const view = await getPerson(db, p1, 'child', child.id);
    expect(view.likeness).toMatchObject({ appearance: 'Curly brown hair and blue eyes.', portrait: expect.stringContaining('portrait%2F'), avatarSource: 'portrait' });
    // The appearance is from the photo; the portrait never reads the generated appearance.
    const describeCall = ai.generateText.mock.calls[0][0];
    expect(describeCall.purpose).toBe('likeness.describe');
    expect(describeCall.prompt.filter((p: { media?: unknown }) => p.media)).toHaveLength(1);
    const portraitCall = ai.generateImage.mock.calls.find(([o]) => o.purpose === 'likeness.portrait')![0];
    expect(JSON.stringify(portraitCall.prompt)).not.toContain('Curly brown hair');
    expect(ai.generateImage.mock.calls.some(([o]) => o.purpose === 'likeness.avatar')).toBe(true);
    expect(view.likenessStatus).toEqual({ describe: 'idle', portrait: 'idle', avatar: 'idle', animate: 'idle' });
  });

  it('only the newest photo set writes the likeness', async () => {
    const child = await createPerson(deps, p1, 'child', { displayName: 'Emma', idempotencyKey: 'create-emma-3' });
    await addPhoto(deps, p1, 'child', child.id, { dataUrl: PNG });
    await addPhoto(deps, p1, 'child', child.id, { dataUrl: PNG });
    await drain();
    // Two describe jobs were queued; the first found a newer photo set and stopped.
    expect(await jobs.using(db).where({ kind: 'likeness.describe' })).toHaveLength(2);
    expect(ai.generateText).toHaveBeenCalledTimes(1);
    expect(ai.generateText.mock.calls[0][0].prompt.filter((p: { media?: unknown }) => p.media)).toHaveLength(2);
  });

  it('removing the last photo deletes the file and clears the appearance and portrait', async () => {
    const child = await createPerson(deps, p1, 'child', { displayName: 'Emma', idempotencyKey: 'create-emma-4' });
    const withPhoto = await addPhoto(deps, p1, 'child', child.id, { dataUrl: PNG });
    await drain();
    const photoId = withPhoto.photoIds[0].id;
    await removePhoto(deps, p1, 'child', child.id, photoId);
    await drain();
    const view = await getPerson(db, p1, 'child', child.id);
    expect(view.likeness).toMatchObject({ photos: [], appearance: null, portrait: null });
    expect(deleted).toEqual([expect.stringMatching(/^users\/p1\/children\/.+\/photos\//)]);
    const stored = await raw('children', child.id);
    expect(stored.imageDescription).toBeUndefined();
    await expect(removePhoto(deps, p1, 'child', child.id, photoId)).rejects.toMatchObject({ code: 'PHOTO_NOT_FOUND' });
  });

  it('keeps a photo chosen as the avatar when a new portrait arrives', async () => {
    const child = await createPerson(deps, p1, 'child', { displayName: 'Emma', idempotencyKey: 'create-emma-5' });
    const withPhoto = await addPhoto(deps, p1, 'child', child.id, { dataUrl: PNG });
    await setAvatar(deps, p1, 'child', child.id, { source: 'photo', photoId: withPhoto.photoIds[0].id });
    await drain();
    const view = await getPerson(db, p1, 'child', child.id);
    expect(view.likeness).toMatchObject({ avatar: withPhoto.likeness.photos[0], avatarSource: 'photo' });
  });

  it('redraws an "imagined" avatar when the description changes', async () => {
    const character = await createPerson(deps, p1, 'character', { displayName: 'Rex', type: 'Pet', description: 'A small dog', idempotencyKey: 'create-rex-1' });
    await drain();
    await updatePerson(deps, p1, 'character', character.id, { description: 'A big fluffy dog' });
    await drain();
    expect(ai.generateImage).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(ai.generateImage.mock.calls[1][0].prompt)).toContain('big fluffy dog');
    // Characters are not animated.
    expect(ai.call).not.toHaveBeenCalled();
  });

  it('lists only the caller’s people and refuses another family', async () => {
    await db.collection('characters').doc('old').set({ ownerUid: 'p1', displayName: 'Granny', likeness: { appearance: 'Grey hair' } });
    await db.collection('characters').doc('gone').set({ ownerUid: 'p1', displayName: 'Gone', deletedAt: new Date() });
    await db.collection('characters').doc('theirs').set({ ownerUid: 'p2', displayName: 'Theirs' });
    await db.collection('characters').doc('scoped').set({ ownerUid: 'p1', displayName: 'Ziggy', childId: 'other-child' });
    await createPerson(deps, p1, 'character', { displayName: 'Rex', idempotencyKey: 'create-rex-2' });
    expect((await listPeople(db, p1, 'character')).map((p) => p.displayName)).toEqual(['Granny', 'Rex', 'Ziggy']);
    expect((await listPeople(db, p1, 'character', { childId: 'c1' })).map((p) => p.displayName)).toEqual(['Granny', 'Rex']);
    expect((await listPeople(db, p1, 'character'))[0].likeness.appearance).toBe('Grey hair');
    await expect(getPerson(db, p2, 'character', 'old')).rejects.toThrow();
    await expect(updatePerson(deps, p1, 'character', 'theirs', { displayName: 'Mine' })).rejects.toThrow();
  });

  it('appends the help-tour sample character only when asked', async () => {
    await db.collection('characters').doc('help-character').set({ ownerUid: 'help', displayName: 'Helper' });
    await createPerson(deps, p1, 'character', { displayName: 'Rex', idempotencyKey: 'create-rex-3' });
    expect((await listPeople(db, p1, 'character')).map((p) => p.id)).not.toContain('help-character');
    expect((await listPeople(db, p1, 'character', { includeHelp: true })).map((p) => p.displayName)).toEqual(['Rex', 'Helper']);
    // Any signed-in user may read a help sample, and nobody may change it.
    expect((await getPerson(db, p2, 'character', 'help-character')).displayName).toBe('Helper');
    await expect(updatePerson(deps, p1, 'character', 'help-character', { displayName: 'Mine' })).rejects.toThrow();
  });

  it('answers GET /api/children in the shape the mobile app reads', async () => {
    await db.collection('children').doc('c1').set({ ownerUid: 'p1', displayName: 'Emma', likeness: { avatar: 'https://img/a.png' } });
    const response = await legacyChildrenResponse(db, p1);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: 'c1', displayName: 'Emma', likeness: { avatar: 'https://img/a.png' } });
  });

  it('still runs character.avatar jobs queued before 5.7', async () => {
    await db.collection('characters').doc('ai1').set({ ownerUid: 'p1', displayName: 'Moon', origin: 'story', description: 'A sleepy moon', photos: [] });
    const runner = (deps.runner as unknown as JobRunner);
    await runner.enqueue([{ kind: 'character.avatar', ownerUid: 'p1', target: { collection: 'characters', id: 'ai1' }, input: { characterId: 'ai1' } }]);
    await drain();
    expect(readLikeness(await raw('characters', 'ai1'))).toMatchObject({ avatarSource: 'description', avatar: expect.stringContaining('avatar%2F') });
  });

  it('builds prompts from the person', () => {
    const emma = normalize('child', 'c1', { ownerUid: 'p1', displayName: 'Emma', pronouns: 'she/her', description: 'Tall for her age' });
    expect(describePrompt(emma)).toContain('Refer to this child as "she"');
    expect(portraitPrompt(emma)).toContain('Description: Tall for her age');
    expect(photoIdOf('https://img/1.jpg')).toHaveLength(12);
  });
});
