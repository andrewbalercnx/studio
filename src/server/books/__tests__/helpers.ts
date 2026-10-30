/**
 * Test bench for the Book pipeline: in-memory Firestore, the real job runner
 * with the in-process dispatcher, and fakes for AI, Storage, image fetching
 * and TTS. Not a test file itself.
 */
import { vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { InProcessDispatcher } from '../../jobs/dispatcher';
import { JobRegistry } from '../../jobs/registry';
import { JobRunner } from '../../jobs/runner';
import type { VerifiedUser } from '../../http/auth';
import { FakeFirestore } from '../../testing/fake-firestore';
import type { BookJobDeps } from '../deps';
import { registerBookJobs } from '../jobs';
import type { BookServiceDeps } from '../service';
import type { PaginationOutput } from '../pagination';
import type { ConfigDefinition } from '../../config/config-service';

export const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

export function user(uid: string, claims: Record<string, unknown> = {}): VerifiedUser {
  return { uid, email: null, claims: { uid, ...claims } as unknown as VerifiedUser['claims'] };
}

/** A model response with `count` pages, Emma and Rex on each, a garden then a kitchen. */
export function paginationResponse(count: number): PaginationOutput {
  return {
    pages: Array.from({ length: count }, (_, i) => ({
      pageNumber: i + 1,
      text: `$$c1$$ and $$ch1$$ play on page ${i + 1}. [giggles] They laugh.`,
      actors: ['c1', 'ch1'],
      imageScene: {
        locationKey: i < count / 2 ? 'garden' : 'kitchen',
        locationDescription: i === 0 ? 'a sunny garden with tall sunflowers' : i === Math.ceil(count / 2) ? 'a cosy yellow kitchen' : '',
        actors: [
          { id: 'c1', action: `jumping over $$ch1$$ (page ${i + 1})` },
          { id: 'ch1', action: 'wagging happily' },
        ],
        atmosphere: 'bright morning light',
        sceneTag: i < count / 2 ? 'outdoor-day' : 'not-a-tag',
      },
    })),
    cover: {
      locationKey: 'garden',
      locationDescription: 'the sunflower garden at golden hour',
      actors: [{ id: 'ch1', action: 'leaping into the air' }],
      atmosphere: 'Cover composition: wide shot',
      sceneTag: 'outdoor-day',
    },
  };
}

export type Bench = {
  fake: FakeFirestore;
  db: Firestore;
  dispatcher: InProcessDispatcher;
  runner: JobRunner;
  deps: BookJobDeps;
  services: BookServiceDeps;
  ai: {
    generateText: ReturnType<typeof vi.fn>;
    generateImage: ReturnType<typeof vi.fn>;
    call: ReturnType<typeof vi.fn>;
  };
  fetched: string[];
  saved: Map<string, { contentType: string; size: number }>;
  tts: ReturnType<typeof vi.fn>;
  testMode: { on: boolean };
  drain: () => Promise<void>;
};

export function createBench(): Bench {
  const fake = new FakeFirestore(() => Date.now());
  const db = fake.asFirestore();
  const dispatcher = new InProcessDispatcher({ sleep: async () => undefined });
  const fetched: string[] = [];
  const saved = new Map<string, { contentType: string; size: number }>();
  const testMode = { on: false };

  const ai = {
    generateText: vi.fn(async (options: { prompt: string }) => {
      const match = /EXACTLY (\d+) pages/.exec(String(options.prompt));
      return { text: '', output: paginationResponse(match ? Number(match[1]) : 12), model: {}, usage: null, attempts: 1 };
    }),
    generateImage: vi.fn(async () => ({ mediaUrl: PNG_DATA_URL, text: '', model: {}, attempts: 1 })),
    call: vi.fn(async (options: { run: (model: unknown) => Promise<unknown> }) => {
      const model = { purpose: 'narration', model: 'elevenlabs/eleven_v3', kind: 'tts', source: 'default' };
      return { result: await options.run(model), model, attempts: 1 };
    }),
  };
  const tts = vi.fn(async () => Buffer.from('mp3'));

  const deps: BookJobDeps = {
    ai: ai as unknown as BookJobDeps['ai'],
    blobs: {
      async save(storagePath, data, contentType) {
        saved.set(storagePath, { contentType, size: data.length });
        return { storagePath, url: `https://storage.test/${storagePath}` };
      },
    },
    fetchImage: async (url) => {
      fetched.push(url);
      return `data:image/png;base64,${Buffer.from(url).toString('base64')}`;
    },
    tts: tts as unknown as BookJobDeps['tts'],
    config: { get: async <S extends ConfigDefinition>(definition: S) => definition.defaults } as BookJobDeps['config'],
    testMode: () => testMode.on,
    now: () => new Date('2026-10-29T12:00:00Z'),
  };

  const registry = registerBookJobs(new JobRegistry(), async () => deps);
  const runner = new JobRunner({ registry, dispatcher, db, retryDelayMs: () => 0 });
  return {
    fake,
    db,
    dispatcher,
    runner,
    deps,
    services: { db, runner, now: () => new Date('2026-10-29T12:00:00Z') },
    ai,
    fetched,
    saved,
    tts,
    testMode,
    drain: () => dispatcher.drain(),
  };
}

/** A family (p1) with a child, a pet without photos, another family's character, a Form and a Style. */
export async function seed(db: Firestore): Promise<void> {
  await db.collection('stories').doc('s1').set({
    parentUid: 'p1',
    childId: 'c1',
    storyText: '$$c1$$ found $$ch1$$ in the garden. $$stranger1234567890$$ waved. They had a lovely day.',
    actors: ['c1', 'ch1', 'stranger1234567890'],
    synopsis: 'Emma and Rex have a lovely day.',
    metadata: { title: 'The Big Day' },
  });
  await db.collection('children').doc('c1').set({
    ownerParentUid: 'p1',
    displayName: 'Emma',
    namePronunciation: 'EM-uh',
    imageDescription: 'curly red hair, green eyes',
    canonicalImageUrl: 'https://img.test/portrait-c1.png',
    photos: ['https://img.test/c1-photo.jpg', 'https://picsum.photos/seed/c1/400'],
    avatarUrl: 'https://picsum.photos/seed/c1/200',
    preferredVoiceId: 'voice-emma',
  });
  await db.collection('characters').doc('ch1').set({
    ownerParentUid: 'p1',
    displayName: 'Rex',
    type: 'Pet',
    description: 'a scruffy terrier',
    photos: [],
    avatarUrl: 'https://picsum.photos/seed/rex/200',
  });
  await db.collection('characters').doc('stranger1234567890').set({
    ownerParentUid: 'p2',
    displayName: 'Stranger',
    photos: ['https://img.test/stranger.jpg'],
  });
  await db.collection('storyOutputTypes').doc('picture').set({
    name: 'Picture book',
    status: 'live',
    category: 'picture_book',
    layoutHints: { pageCount: 12, textDensity: 'low' },
    paginationPrompt: 'Make it bouncy.',
  });
  await db.collection('storyOutputTypes').doc('poem').set({ name: 'Poem', status: 'live', category: 'poem', layoutHints: { pageCount: 6 } });
  await db.collection('storyOutputTypes').doc('draft').set({ name: 'Draft', status: 'draft', category: 'picture_book' });
  await db.collection('imageStyles').doc('water').set({
    title: 'Watercolour',
    stylePrompt: 'soft watercolour',
    exampleImages: [{ url: 'https://img.test/style-1.png' }],
    sceneExemplars: { 'outdoor-day': { imageUrl: 'https://img.test/scene-outdoor.png', status: 'ready' } },
  });
  await db.collection('printLayouts').doc('tiny').set({ name: 'Tiny', leafWidth: 8, leafHeight: 8, pageConstraints: { maxPages: 20, pageMultiple: 4 } });
  await db.collection('printLayouts').doc('square').set({ name: 'Square', leafWidth: 8, leafHeight: 8, pageConstraints: { maxPages: 40, pageMultiple: 4 } });
}
