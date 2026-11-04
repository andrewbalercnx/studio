import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { TEST_MODE_IMAGE_DATA_URL } from '@/lib/test-mode';
import { InProcessDispatcher } from '../../jobs/dispatcher';
import { JobRegistry } from '../../jobs/registry';
import { JobRunner } from '../../jobs/runner';
import { FakeFirestore } from '../../testing/fake-firestore';
import { buildAvatarPrompt, characterAvatarSpec, registerCharacterJobs, type CharacterAvatarDeps } from '../avatar';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function bench(overrides: Partial<CharacterAvatarDeps> = {}) {
  const fake = new FakeFirestore(() => Date.now());
  const db = fake.asFirestore();
  const dispatcher = new InProcessDispatcher({ sleep: async () => undefined });
  const saved = new Map<string, { contentType: string; size: number }>();
  const generateImage = vi.fn(async () => ({ mediaUrl: PNG_DATA_URL, text: '', model: {}, attempts: 1 }));
  const deps: CharacterAvatarDeps = {
    ai: { generateImage } as unknown as CharacterAvatarDeps['ai'],
    blobs: {
      async save(storagePath, data, contentType) {
        saved.set(storagePath, { contentType, size: data.length });
        return { storagePath, url: `https://storage.test/${storagePath}` };
      },
    },
    testMode: () => false,
    now: () => new Date('2026-11-04T12:00:00Z'),
    ...overrides,
  };
  const registry = registerCharacterJobs(new JobRegistry(), async () => deps);
  const runner = new JobRunner({ registry, dispatcher, db, retryDelayMs: () => 0 });
  return { db, dispatcher, runner, generateImage, saved, drain: () => dispatcher.drain() };
}

async function character(db: Firestore, id: string, data: Record<string, unknown>) {
  await db.collection('characters').doc(id).set({ ownerParentUid: 'p1', origin: 'story', photos: [], ...data });
}

async function read(db: Firestore, id: string) {
  return (await db.collection('characters').doc(id).get()).data() as Record<string, unknown> | undefined;
}

describe('buildAvatarPrompt', () => {
  it('names the character, its kind and its appearance, and bans text in the image', () => {
    const prompt = buildAvatarPrompt({ displayName: 'Pip', type: 'Pet', description: 'a scruffy orange kitten' });
    expect(prompt).toContain('Pip');
    expect(prompt).toContain('a pet');
    expect(prompt).toContain('a scruffy orange kitten');
    expect(prompt).toMatch(/no .*text|text, words, letters/i);
  });

  it('reads pronouns for a person and copes with missing fields', () => {
    expect(buildAvatarPrompt({ displayName: 'Mia', type: 'Friend', pronouns: 'she/her' })).toContain('a girl');
    expect(buildAvatarPrompt({ displayName: 'Sam', type: 'Friend', pronouns: 'he/him' })).toContain('a boy');
    // No description, no pronouns: still a usable prompt.
    expect(buildAvatarPrompt({ displayName: 'Nova' })).toContain('a character');
  });
});

describe('character.avatar job', () => {
  it('draws an avatar from the description and stores it under a per-attempt path', async () => {
    const b = bench();
    await character(b.db, 'ch_story1', { displayName: 'Pip', type: 'Pet', description: 'a scruffy orange kitten' });

    await b.runner.enqueue([characterAvatarSpec({ id: 'ch_story1', ownerUid: 'p1' })]);
    await b.drain();

    const doc = await read(b.db, 'ch_story1');
    expect(doc?.avatarUrl).toMatch(/^https:\/\/storage\.test\/characters\/ch_story1\/avatar\//);
    expect((doc?.avatarGeneration as { status?: string })?.status).toBe('ready');
    // Display only: the likeness portrait is never touched (ADR-0006).
    expect(doc?.canonicalImageUrl).toBeUndefined();
    expect(b.generateImage).toHaveBeenCalledTimes(1);
    expect([...b.saved.keys()][0]).toMatch(/characters\/ch_story1\/avatar\/.+-\d+\.png$/);
  });

  it('writes a fixture without an AI call in TEST_MODE', async () => {
    const b = bench({ testMode: () => true });
    await character(b.db, 'ch_story2', { displayName: 'Rex', type: 'Pet' });

    await b.runner.enqueue([characterAvatarSpec({ id: 'ch_story2', ownerUid: 'p1' })]);
    await b.drain();

    const doc = await read(b.db, 'ch_story2');
    expect(doc?.avatarUrl).toBe(TEST_MODE_IMAGE_DATA_URL);
    expect(b.generateImage).not.toHaveBeenCalled();
  });

  it('is a no-op when the character no longer exists', async () => {
    const b = bench();
    await b.runner.enqueue([characterAvatarSpec({ id: 'gone', ownerUid: 'p1' })]);
    await b.drain();
    expect(b.generateImage).not.toHaveBeenCalled();
    expect(await read(b.db, 'gone')).toBeUndefined();
  });

  it('marks the character failed after the last attempt when the model will not draw it', async () => {
    const generateImage = vi.fn(async () => {
      throw new Error('SAFETY: blocked');
    });
    const b = bench({ ai: { generateImage } as unknown as CharacterAvatarDeps['ai'] });
    await character(b.db, 'ch_story3', { displayName: 'Boom', type: 'Other' });

    await b.runner.enqueue([characterAvatarSpec({ id: 'ch_story3', ownerUid: 'p1' })]);
    await b.drain();

    const doc = await read(b.db, 'ch_story3');
    expect(doc?.avatarUrl).toBeUndefined();
    expect((doc?.avatarGeneration as { status?: string })?.status).toBe('failed');
    expect(generateImage.mock.calls.length).toBeGreaterThan(1); // retried (IMAGE_REJECTED is retryable)
  });
});
