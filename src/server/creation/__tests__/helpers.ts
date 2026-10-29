/**
 * Test bench for the creation slice: in-memory Firestore, the real job runner
 * with the in-process dispatcher (story.finish and the Book pipeline
 * registered), a fake AI harness and a TEST_MODE switch. Not a test file.
 */
import { vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { ConfigDefinition } from '../../config/config-service';
import { InProcessDispatcher } from '../../jobs/dispatcher';
import { JobRegistry } from '../../jobs/registry';
import { JobRunner } from '../../jobs/runner';
import type { VerifiedUser } from '../../http/auth';
import { FakeFirestore } from '../../testing/fake-firestore';
import { registerBookJobs } from '../../books/jobs';
import type { BookJobDeps } from '../../books/deps';
import type { BookServiceDeps } from '../../books/service';
import type { EngineSetDeps } from '../engines';
import { registerCreationJobs, type FinishDeps } from '../finish';
import type { CreationServiceDeps } from '../service';
import { listStoryTypesForAge, loadStoryType } from '../story-types';

export const NOW = new Date('2026-10-29T12:00:00Z');

export function user(uid: string, claims: Record<string, unknown> = {}): VerifiedUser {
  return { uid, email: null, claims: { uid, ...claims } as unknown as VerifiedUser['claims'] };
}

/** A fake `generateText`: answers by flowName from `responses`, recording calls. */
export type FakeText = ReturnType<typeof vi.fn> & {
  respond: (flowName: string, answer: unknown | ((options: Record<string, unknown>) => unknown)) => void;
};

export function fakeGenerateText(): FakeText {
  const answers = new Map<string, unknown | ((options: Record<string, unknown>) => unknown)>();
  const fn = vi.fn(async (options: Record<string, unknown>) => {
    const flowName = String(options.flowName);
    if (!answers.has(flowName)) throw new Error(`fake AI: no answer for ${flowName}`);
    const answer = answers.get(flowName);
    const value = typeof answer === 'function' ? await (answer as (o: Record<string, unknown>) => unknown)(options) : answer;
    if (value instanceof Error) throw value;
    if (typeof value === 'string') return { text: value, output: null, model: {}, usage: null, attempts: 1 };
    return { text: JSON.stringify(value), output: value, model: {}, usage: null, attempts: 1 };
  }) as FakeText;
  fn.respond = (flowName, answer) => answers.set(flowName, answer);
  return fn;
}

export type Bench = {
  fake: FakeFirestore;
  db: Firestore;
  dispatcher: InProcessDispatcher;
  runner: JobRunner;
  ai: FakeText;
  testMode: { on: boolean };
  /** story.finish's TEST_MODE; null = follow `testMode`. */
  finishTestMode: { on: boolean | null };
  services: CreationServiceDeps;
  bookServices: BookServiceDeps;
  drain: () => Promise<void>;
};

export function createBench(options: { testMode?: boolean } = {}): Bench {
  const fake = new FakeFirestore(() => NOW.getTime());
  const db = fake.asFirestore();
  const dispatcher = new InProcessDispatcher({ sleep: async () => undefined });
  const testMode = { on: options.testMode ?? true };
  const finishTestMode: { on: boolean | null } = { on: null };
  const ai = fakeGenerateText();
  const config = { get: async <S extends ConfigDefinition>(definition: S) => definition.defaults } as EngineSetDeps['config'];

  const finishDeps: FinishDeps = { ai: { generateText: ai } as unknown as FinishDeps['ai'], testMode: () => finishTestMode.on ?? testMode.on, now: () => NOW };
  const bookDeps: BookJobDeps = {
    ai: { generateText: vi.fn(), generateImage: vi.fn(), call: vi.fn() } as unknown as BookJobDeps['ai'],
    blobs: { save: async (storagePath) => ({ storagePath, url: `https://storage.test/${storagePath}` }) },
    fetchImage: async () => 'data:image/png;base64,AAAA',
    tts: async () => Buffer.from('mp3'),
    config: config as BookJobDeps['config'],
    testMode: () => true,
    now: () => NOW,
  };
  const registry = new JobRegistry();
  registerBookJobs(registry, async () => bookDeps);
  registerCreationJobs(registry, async () => finishDeps);
  const runner = new JobRunner({ registry, dispatcher, db, retryDelayMs: () => 0 });

  const engines: EngineSetDeps = {
    ai: { generateText: ai } as unknown as EngineSetDeps['ai'],
    testMode: () => testMode.on,
    config,
    storyTypes: { listForAge: (age) => listStoryTypesForAge(db, age), load: (id) => loadStoryType(db, id) },
  };
  return {
    fake,
    db,
    dispatcher,
    runner,
    ai,
    testMode,
    finishTestMode,
    services: { db, runner, engines, now: () => NOW },
    bookServices: { db, runner, now: () => NOW },
    drain: () => dispatcher.drain(),
  };
}

/**
 * Family p1: Emma (c1, 6) with sibling Sam (c2); Rex the pet (ch1, family-wide);
 * Pip (ch2, Sam's only); another family's character (other1234567890xyz).
 * Five live modes (adventure not for kids, as seeded today) and two story types.
 */
export async function seed(db: Firestore): Promise<void> {
  await db.collection('children').doc('c1').set({
    ownerParentUid: 'p1',
    displayName: 'Emma',
    dateOfBirth: '2020-05-01',
    pronouns: 'she/her',
    likes: ['dinosaurs', 'painting'],
    imageDescription: 'curly red hair',
    photos: ['https://img.test/c1.jpg'],
  });
  await db.collection('children').doc('c2').set({ ownerParentUid: 'p1', displayName: 'Sam', dateOfBirth: '2018-01-01' });
  await db.collection('children').doc('gone').set({ ownerParentUid: 'p1', displayName: 'Gone', deletedAt: new Date() });
  await db.collection('characters').doc('ch1').set({ ownerParentUid: 'p1', displayName: 'Rex', type: 'Pet', isParentGenerated: true });
  await db.collection('characters').doc('ch2').set({ ownerParentUid: 'p1', displayName: 'Pip', type: 'Toy', childId: 'c2' });
  await db.collection('characters').doc('other1234567890xyz').set({ ownerParentUid: 'p2', displayName: 'Stranger', type: 'Friend' });
  await db.collection('children').doc('k2').set({ ownerParentUid: 'p2', displayName: 'Kid of p2' });

  const generator = (extra: Record<string, unknown>) => ({ status: 'live', enabledForKids: true, name: 'X', description: 'Y', ...extra });
  await db.collection('storyGenerators').doc('wizard').set(generator({ name: 'Story Wizard' }));
  await db.collection('storyGenerators').doc('gemini3').set(generator({ name: 'Gemini Free' }));
  await db.collection('storyGenerators').doc('gemini4').set(generator({ name: 'Guided Story' }));
  await db.collection('storyGenerators').doc('friends').set(generator({ name: 'Fun with my friends' }));
  await db.collection('storyGenerators').doc('beat').set({ status: 'live', name: 'Story Beats', description: 'Beats' });

  await db.collection('storyTypes').doc('quest').set({
    name: 'Quest',
    shortDescription: 'A brave quest',
    status: 'live',
    ageFrom: 3,
    ageTo: 8,
    arcTemplate: { steps: ['setup', { id: 'meet', label: 'Meet a friend', suggestsNewCharacter: true }, 'resolve'] },
    promptConfig: {
      roleDefinition: 'You are a quest guide.',
      behaviorRules: ['Be kind'],
      narrativeStyle: 'Lively',
      thematicElements: ['courage'],
      pacing: 'moderate',
      emotionalTone: 'adventurous',
      storyBeatInstructions: 'Write one paragraph.',
      model: { name: 'googleai/gemini-2.5-flash', temperature: 0.6 },
    },
  });
  await db.collection('storyTypes').doc('teen').set({ name: 'Teen Saga', status: 'live', ageFrom: 13, arcTemplate: { steps: ['a'] } });
  await db.collection('storyTypes').doc('draft').set({ name: 'Draft', status: 'draft', arcTemplate: { steps: ['a'] } });
}

export async function ledgerUsed(db: Firestore, uid = 'p1'): Promise<number> {
  const snapshot = await db.collection('entitlementLedgers').doc(uid).get();
  const data = snapshot.data() as { family?: { story_allowance?: { used?: number } }; children?: Record<string, { story_allowance?: { used?: number } }> } | undefined;
  const family = data?.family?.story_allowance?.used ?? 0;
  const children = Object.values(data?.children ?? {}).reduce((sum, c) => sum + (c.story_allowance?.used ?? 0), 0);
  return family + children;
}

let keyCounter = 0;
export function key(): string {
  keyCounter += 1;
  return `test-key-${String(keyCounter).padStart(4, '0')}`;
}
