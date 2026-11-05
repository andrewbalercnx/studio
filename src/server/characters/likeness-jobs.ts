/**
 * Likeness jobs (slice 5.7, ADR-0006, pipeline.md "Likeness").
 *
 *   photos change ─▶ likeness.describe  (ai-text)  appearance from the original photos only
 *                └▶ likeness.portrait  (ai-image) canonical portrait from the original photos only
 *                         └▶ likeness.avatar (ai-image) from the portrait, unless the parent chose a photo
 *   create with no photos ─▶ likeness.avatar from the description ("imagined")
 *   a child's avatar changes ─▶ likeness.animate (ai-image queue; video provider)
 *
 * Every job names the inputs it works from (the photo set, the portrait, the
 * description, the avatar). If the document has moved on by the time it would
 * write, a newer job owns the field and this one stops without writing. Files
 * are stored per job attempt, so a retry never overwrites a file a document
 * points at. TEST_MODE writes fixtures without calling a model.
 *
 * The appearance and the portrait are both made from the photos and never from
 * each other or from the avatar: two independent signals (CLAUDE.md).
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { TEST_MODE_IMAGE_DATA_URL } from '@/lib/test-mode';
import type { AIHarness } from '../ai/harness';
import { NoImageReturnedError } from '../ai/harness';
import { decodeMedia, extensionFor, fetchImageAsDataUri, firebaseBlobStore, type BlobStore, type FetchImage } from '../books/media';
import type { WithId } from '../data/repository';
import type { Job } from '../data/schemas/job';
import { COLLECTION_FOR, type PersonKind } from '../data/schemas/people';
import { JobFailure, type JobContext, type JobDefinition, type JobRegistry, type JobSpec } from '../jobs/registry';
import { toJobError } from '../jobs/runner';
import { falImageToVideo, isVeoModel, veoImageToVideo } from './animation';
import { likenessWrite, normalize, photosKey, textKey, type Person } from './entities';

export const LIKENESS_JOB_KINDS = {
  describe: 'likeness.describe',
  portrait: 'likeness.portrait',
  avatar: 'likeness.avatar',
  animate: 'likeness.animate',
} as const;
/** Former name of the description avatar job (#33); still registered for jobs already queued. */
export const CHARACTER_AVATAR_KIND = 'character.avatar';

export type LikenessJobDeps = {
  ai: Pick<AIHarness, 'generateText' | 'generateImage' | 'call'>;
  blobs: BlobStore;
  fetchImage: FetchImage;
  testMode: () => boolean;
  env: { falKey?: string; geminiKey?: string };
};

type Target = { kind: PersonKind; id: string; ownerUid: string };

function spec(kind: string, person: Target, input: Record<string, unknown>, key: string, nonce?: string | null): JobSpec {
  return {
    kind,
    ownerUid: person.ownerUid,
    target: { collection: COLLECTION_FOR[person.kind], id: person.id },
    input: { kind: person.kind, id: person.id, ...input },
    idempotencyKey: `${kind}:${person.kind}:${person.id}:${key}${nonce ? `:${nonce}` : ''}`,
  };
}

/** Describe and portrait for the current photo set (a refresh passes a nonce to run again). */
export function likenessSpecs(person: Target, photos: string[], nonce: string | null = null): JobSpec[] {
  const key = photosKey(photos);
  return [
    spec(LIKENESS_JOB_KINDS.describe, person, { photosKey: key }, key, nonce),
    spec(LIKENESS_JOB_KINDS.portrait, person, { photosKey: key }, key, nonce),
  ];
}

export function avatarSpec(person: Target, source: 'portrait' | 'description', basis: string | null, nonce: string | null = null): JobSpec {
  const basisKey = textKey(basis);
  return spec(LIKENESS_JOB_KINDS.avatar, person, { source, basisKey }, `${source}:${basisKey}`, nonce);
}

export function animateSpec(person: Target, avatar: string): JobSpec {
  const avatarKey = textKey(avatar);
  return spec(LIKENESS_JOB_KINDS.animate, person, { avatarKey }, avatarKey);
}

// ---------------------------------------------------------------------------
// Prompts (ported from image-description-flow, canonical-image-flow,
// avatar-flow and character-avatar-flow; exported for tests)
// ---------------------------------------------------------------------------

function subjectLabel(person: Person): string {
  return person.kind === 'child' ? 'child' : (person.type ?? 'character').toLowerCase();
}

export function describePrompt(person: Person): string {
  const label = subjectLabel(person);
  const pronouns = person.pronouns ?? 'they/them';
  const subject = pronouns === 'he/him' ? 'he' : pronouns === 'she/her' ? 'she' : 'they';
  const verb = subject === 'they' ? 'have' : 'has';
  return `Analyze the provided photo(s) of a ${label} and generate a concise description of their physical appearance suitable for AI image generation.

Include:
- Hair color and style (e.g., "curly brown hair", "blonde pigtails")
- Eye color (if visible)
- Skin tone
- Approximate age appearance (for children)
- Any distinctive features (glasses, freckles, etc.)

Output 2-3 sentences, approximately 50-100 words. Focus only on visual appearance, not personality. Use neutral, descriptive language suitable for image generation prompts. Refer to this ${label} as "${subject}" (${pronouns}); do not use "they" unless those are their pronouns.

Example: "A young child around 5 years old. ${subject.charAt(0).toUpperCase() + subject.slice(1)} ${verb} curly brown hair and bright blue eyes, with fair skin and a few freckles across the nose."`;
}

/** The portrait is drawn from the photos; it never reads the generated appearance (two independent signals). */
export function portraitPrompt(person: Person): string {
  const context = person.description ? `\n\nDescription: ${person.description}` : '';
  return `Create a clean, naturalistic portrait of ${person.displayName} (a ${subjectLabel(person)}) based on the reference photos provided.${context}

Requirements:
1. PORTRAIT STYLE: Photorealistic or clean naturalistic rendering — no cartoon, no art style, no painterly effects
2. LIKENESS: Accurately reproduce the subject's appearance from the photos — hair color/style, eye color, skin tone, distinctive features
3. POSE: Front-facing or slight 3/4 view; shoulders and face clearly visible; friendly expression
4. BACKGROUND: Plain white or very light neutral background — no scenery, no props
5. LIGHTING: Soft, even, flattering light — no harsh shadows
6. QUALITY: High detail on facial features — this image will be used as a reference for character consistency across illustrated storybooks

This is a reference portrait used for downstream AI image generation. Accuracy of likeness is the highest priority.`;
}

function avatarSubject(person: Person): string {
  if (person.kind === 'child') return 'child';
  if (person.type === 'Pet') return 'pet';
  if (person.type === 'Toy') return 'toy';
  if (person.pronouns === 'he/him') return 'boy';
  if (person.pronouns === 'she/her') return 'girl';
  return 'character';
}

export function avatarFromPortraitPrompt(person: Person): string {
  return `Based on the provided portrait of ${person.displayName}, a ${avatarSubject(person)}, generate a single, simple, friendly, cartoon-style avatar for a children's storybook app. Keep them recognisable: the same hair, skin tone, eye colour and distinctive features. A head and shoulders shot on a plain, soft-coloured background, with a happy expression. Do not put any text, words, letters or captions in the image.`;
}

export function avatarFromDescriptionPrompt(person: Person): string {
  const lines = [`A friendly head-and-shoulders avatar portrait of ${person.displayName}, a ${avatarSubject(person)} in a children's storybook.`];
  if (person.description) lines.push(`Appearance: ${person.description}.`);
  lines.push(
    'Warm, colourful storybook illustration with soft lighting, a gentle happy expression and a simple plain background.',
    'Centred, facing the viewer. Do not put any text, words, letters or captions in the image.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared handler plumbing
// ---------------------------------------------------------------------------

type Part = { text: string } | { media: { url: string } };
type PartName = 'describe' | 'portrait' | 'avatar' | 'animate';
type Input = { kind: PersonKind; id: string; photosKey?: string; source?: 'portrait' | 'description'; basisKey?: string; avatarKey?: string };

const IMAGE_REJECTED = /did not match the expected pattern|INVALID_ARGUMENT|SAFETY|blocked|recitation/i;

function asImageFailure(error: unknown): unknown {
  if (error instanceof JobFailure) return error;
  const message = (error as Error)?.message ?? String(error);
  if (error instanceof NoImageReturnedError || IMAGE_REJECTED.test(message)) {
    return new JobFailure('IMAGE_REJECTED', message, { retryable: true, cause: error });
  }
  return error;
}

function isFinalAttempt(job: WithId<Job>, error: unknown): boolean {
  return !toJobError(error).retryable || job.attempt >= job.maxAttempts;
}

async function load(db: Firestore, input: Input): Promise<Person | null> {
  const snapshot = await db.collection(COLLECTION_FOR[input.kind]).doc(input.id).get();
  if (!snapshot.exists) return null;
  const person = normalize(input.kind, input.id, snapshot.data() ?? {});
  return person.deleted ? null : person;
}

/** Still the inputs this job was made for? */
function current(part: PartName, person: Person, input: Input): boolean {
  if (part === 'describe' || part === 'portrait') return photosKey(person.likeness.photos) === input.photosKey;
  if (part === 'avatar') {
    if (person.likeness.avatarSource === 'photo') return false; // the parent chose a photo since
    const basis = input.source === 'portrait' ? person.likeness.portrait : person.description;
    return textKey(basis) === input.basisKey;
  }
  return !!person.likeness.avatar && textKey(person.likeness.avatar) === input.avatarKey;
}

/** Write the result only if the inputs are still current (in a transaction). */
async function commit(
  ctx: JobContext,
  part: PartName,
  input: Input,
  values: Parameters<typeof likenessWrite>[0]
): Promise<Person | null> {
  const ref = ctx.db.collection(COLLECTION_FOR[input.kind]).doc(input.id);
  return ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const person = normalize(input.kind, input.id, snapshot.data() ?? {});
    if (person.deleted || !current(part, person, input)) return null;
    tx.update(ref, likenessWrite({ ...values, jobs: { [part]: { jobId: ctx.job.jobId, status: 'succeeded' } } }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    return normalize(input.kind, input.id, { ...snapshot.data(), likeness: { ...(snapshot.data()?.likeness ?? {}), ...values } });
  });
}

async function markJob(ctx: JobContext, input: Input, part: PartName, status: 'running' | 'failed'): Promise<void> {
  const ref = ctx.db.collection(COLLECTION_FOR[input.kind]).doc(input.id);
  await ref.update({ [`likeness.likenessJob.${part}`]: { jobId: ctx.job.jobId, status }, updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
}

async function imagesOf(deps: LikenessJobDeps, urls: string[]): Promise<Part[]> {
  const fetched = await Promise.all(urls.map((url) => deps.fetchImage(url)));
  return fetched.filter((uri): uri is string => !!uri).map((uri) => ({ media: { url: uri } }));
}

async function storeImage(deps: LikenessJobDeps, ctx: JobContext, input: Input, part: string, mediaUrl: string): Promise<string> {
  const { contentType, data } = await decodeMedia(mediaUrl);
  const stored = await deps.blobs.save(
    `${COLLECTION_FOR[input.kind]}/${input.id}/${part}/${ctx.job.jobId}-${ctx.job.attempt}.${extensionFor(contentType)}`,
    data,
    contentType,
    { [input.kind === 'child' ? 'childId' : 'characterId']: input.id, ownerUid: ctx.job.ownerUid }
  );
  return stored.url;
}

/** Run one part with the running/failed bookkeeping every job shares. */
function handler(part: PartName, getDeps: () => Promise<LikenessJobDeps>, work: (ctx: JobContext, deps: LikenessJobDeps, person: Person, input: Input) => Promise<void>): JobDefinition['run'] {
  return async (ctx) => {
    const input = ctx.job.input as Input;
    const person = await load(ctx.db, input);
    if (!person || !current(part, person, input)) return; // deleted, or a newer job owns this part
    await markJob(ctx, input, part, 'running');
    const deps = await getDeps();
    try {
      await work(ctx, deps, person, input);
    } catch (error) {
      const failure = part === 'describe' ? error : asImageFailure(error);
      if (isFinalAttempt(ctx.job, failure)) await markJob(ctx, input, part, 'failed');
      throw failure;
    }
  };
}

// ---------------------------------------------------------------------------
// The four jobs
// ---------------------------------------------------------------------------

const describe = (getDeps: () => Promise<LikenessJobDeps>) =>
  handler('describe', getDeps, async (ctx, deps, person, input) => {
    if (person.likeness.photos.length === 0) {
      await commit(ctx, 'describe', input, { appearance: null });
      return;
    }
    let appearance: string;
    if (deps.testMode()) {
      appearance = `A test likeness of ${person.displayName}, described from ${person.likeness.photos.length} photo(s).`;
    } else {
      const images = await imagesOf(deps, person.likeness.photos.slice(0, 3));
      if (images.length === 0) throw new JobFailure('PHOTOS_UNREADABLE', 'None of the photos could be fetched', { retryable: true });
      const { text } = await deps.ai.generateText({
        purpose: 'likeness.describe',
        flowName: 'likeness.describe',
        ownerUid: ctx.job.ownerUid,
        prompt: [...images, { text: describePrompt(person) }],
      });
      appearance = text.trim();
      if (!appearance) throw new JobFailure('EMPTY_DESCRIPTION', 'The model returned no description', { retryable: true });
    }
    await commit(ctx, 'describe', input, { appearance });
  });

const portrait = (getDeps: () => Promise<LikenessJobDeps>) =>
  handler('portrait', getDeps, async (ctx, deps, person, input) => {
    if (person.likeness.photos.length === 0) {
      await commit(ctx, 'portrait', input, { portrait: null });
      return;
    }
    let url: string;
    if (deps.testMode()) {
      url = await storeImage(deps, ctx, input, 'portrait', TEST_MODE_IMAGE_DATA_URL);
    } else {
      const images = await imagesOf(deps, person.likeness.photos.slice(0, 5));
      if (images.length === 0) throw new JobFailure('PHOTOS_UNREADABLE', 'None of the photos could be fetched', { retryable: true });
      const { mediaUrl } = await deps.ai.generateImage({
        purpose: 'likeness.portrait',
        flowName: 'likeness.portrait',
        ownerUid: ctx.job.ownerUid,
        prompt: [...images, { text: portraitPrompt(person) }],
        config: { imageConfig: { aspectRatio: '1:1' } },
      });
      url = await storeImage(deps, ctx, input, 'portrait', mediaUrl);
    }
    const updated = await commit(ctx, 'portrait', input, { portrait: url });
    // A new portrait redraws the avatar, unless the parent chose one of the photos.
    if (updated && updated.likeness.avatarSource !== 'photo') {
      await ctx.enqueue([avatarSpec({ kind: input.kind, id: input.id, ownerUid: ctx.job.ownerUid }, 'portrait', url)]);
    }
  });

const avatar = (getDeps: () => Promise<LikenessJobDeps>) =>
  handler('avatar', getDeps, async (ctx, deps, person, input) => {
    const source = input.source ?? 'description';
    if (source === 'portrait' && !person.likeness.portrait) return;
    let url: string;
    if (deps.testMode()) {
      url = await storeImage(deps, ctx, input, 'avatar', TEST_MODE_IMAGE_DATA_URL);
    } else {
      const prompt: Part[] = [];
      if (source === 'portrait') {
        const reference = await deps.fetchImage(person.likeness.portrait!);
        if (!reference) throw new JobFailure('PORTRAIT_UNREADABLE', 'The portrait could not be fetched', { retryable: true });
        prompt.push({ media: { url: reference } }, { text: avatarFromPortraitPrompt(person) });
      } else {
        prompt.push({ text: avatarFromDescriptionPrompt(person) });
      }
      const { mediaUrl } = await deps.ai.generateImage({
        purpose: 'likeness.avatar',
        flowName: 'likeness.avatar',
        ownerUid: ctx.job.ownerUid,
        prompt,
        config: { imageConfig: { aspectRatio: '1:1' } },
      });
      url = await storeImage(deps, ctx, input, 'avatar', mediaUrl);
    }
    const updated = await commit(ctx, 'avatar', input, { avatar: url, avatarSource: source });
    if (updated && input.kind === 'child') {
      await ctx.enqueue([animateSpec({ kind: 'child', id: input.id, ownerUid: ctx.job.ownerUid }, url)]);
    }
  });

const animate = (getDeps: () => Promise<LikenessJobDeps>) =>
  handler('animate', getDeps, async (ctx, deps, person, input) => {
    const avatarUrl = person.likeness.avatar!;
    let url: string;
    if (deps.testMode()) {
      url = avatarUrl; // the fixture "animation" is the avatar itself
    } else {
      const { result } = await deps.ai.call({
        purpose: 'likeness.animate',
        flowName: 'likeness.animate',
        ownerUid: ctx.job.ownerUid,
        logPrompt: `Animate the avatar of ${person.displayName}`,
        run: async (model) => {
          if (isVeoModel(model.model)) {
            const image = await deps.fetchImage(avatarUrl);
            if (!image) throw new JobFailure('AVATAR_UNREADABLE', 'The avatar could not be fetched', { retryable: true });
            const { contentType, data } = await decodeMedia(image);
            return veoImageToVideo({ model: model.model, image: { bytes: data, contentType }, key: deps.env.geminiKey });
          }
          return falImageToVideo({ model: model.model, imageUrl: avatarUrl, key: deps.env.falKey });
        },
      });
      const stored = await deps.blobs.save(
        `${COLLECTION_FOR[input.kind]}/${input.id}/animation/${ctx.job.jobId}-${ctx.job.attempt}.mp4`,
        result.bytes,
        result.contentType,
        { ownerUid: ctx.job.ownerUid }
      );
      url = stored.url;
    }
    await commit(ctx, 'animate', input, { avatarAnimation: url });
  });

/** `character.avatar` jobs queued before 5.7 (input `{ characterId }`) run as a description avatar. */
function legacyCharacterAvatar(getDeps: () => Promise<LikenessJobDeps>): JobDefinition['run'] {
  const run = avatar(getDeps);
  return async (ctx) => {
    const { characterId } = ctx.job.input as { characterId: string };
    const person = await load(ctx.db, { kind: 'character', id: characterId });
    if (!person || person.likeness.avatar) return;
    const input: Input = { kind: 'character', id: characterId, source: 'description', basisKey: textKey(person.description) };
    await run({ ...ctx, job: { ...ctx.job, input } });
  };
}

export function registerLikenessJobs(registry: JobRegistry, getDeps: () => Promise<LikenessJobDeps>): JobRegistry {
  return registry
    .register({ kind: LIKENESS_JOB_KINDS.describe, queue: 'ai-text', maxAttempts: 3, run: describe(getDeps) })
    .register({ kind: LIKENESS_JOB_KINDS.portrait, queue: 'ai-image', maxAttempts: 3, run: portrait(getDeps) })
    .register({ kind: LIKENESS_JOB_KINDS.avatar, queue: 'ai-image', maxAttempts: 3, run: avatar(getDeps) })
    // Video generation polls for minutes: a longer lease than the default.
    .register({ kind: LIKENESS_JOB_KINDS.animate, queue: 'ai-image', maxAttempts: 2, leaseMs: 12 * 60_000, run: animate(getDeps) })
    .register({ kind: CHARACTER_AVATAR_KIND, queue: 'ai-image', maxAttempts: 3, run: legacyCharacterAvatar(getDeps) });
}

let defaults: LikenessJobDeps | null = null;

/** Production dependencies: the shared AI harness, Firebase Storage, env TEST_MODE and provider keys. */
export async function defaultLikenessJobDeps(): Promise<LikenessJobDeps> {
  if (defaults) return defaults;
  const [{ getAIHarness }, { isTestMode }] = await Promise.all([import('../ai/harness'), import('@/lib/test-mode')]);
  defaults = {
    ai: getAIHarness(),
    blobs: firebaseBlobStore,
    fetchImage: fetchImageAsDataUri,
    testMode: () => isTestMode(),
    env: { falKey: process.env.FAL_KEY?.trim() || undefined, geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined },
  };
  return defaults;
}
