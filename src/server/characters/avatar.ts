/**
 * `character.avatar`: an avatar picture for a character the story introduced.
 *
 * When a creation mode invents a new character mid-story it is written to
 * `characters/{id}` with `origin: 'story'`, no photos and no picture (see
 * `creation/service.ts` `record`). This job draws a friendly head-and-shoulders
 * avatar from that character's words — name, type, pronouns, description — so the
 * parent and child see a face rather than a blank tile.
 *
 * The avatar is UI only: it is written to `avatarUrl`, never to
 * `canonicalImageUrl`/the likeness portrait. A story character has no original
 * photos, so it has no likeness to anchor to (ADR-0006, CLAUDE.md); the Book
 * pipeline keeps drawing these characters from their description text
 * (`castSheetSource` → `appearance`), not from this avatar.
 *
 * The handler is idempotent (a retry that already produced our avatar stops) and
 * honours TEST_MODE by writing a fixture without an AI call. It stores each
 * attempt under its own path (`characters/{id}/avatar/{jobId}-{attempt}`) so a
 * retry never overwrites a file a document already points at (ADR-0010 spirit).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { TEST_MODE_IMAGE_DATA_URL } from '@/lib/test-mode';
import type { AIHarness } from '../ai/harness';
import { NoImageReturnedError } from '../ai/harness';
import type { WithId } from '../data/repository';
import type { Job } from '../data/schemas/job';
import { JobFailure, type JobDefinition, type JobRegistry, type JobSpec } from '../jobs/registry';
import { toJobError } from '../jobs/runner';
import { decodeMedia, extensionFor, firebaseBlobStore, type BlobStore } from '../books/media';

export const CHARACTER_AVATAR_KIND = 'character.avatar';
const CHARACTERS = 'characters';

export type CharacterAvatarDeps = {
  ai: Pick<AIHarness, 'generateImage'>;
  blobs: BlobStore;
  /** TEST_MODE seam: write a fixture instead of calling the image model. */
  testMode: () => boolean;
  now: () => Date;
};

/** The job that draws one character's avatar. Keyed by the character so a repeat is the same job. */
export function characterAvatarSpec(character: { id: string; ownerUid: string }): JobSpec {
  return {
    kind: CHARACTER_AVATAR_KIND,
    ownerUid: character.ownerUid,
    target: { collection: CHARACTERS, id: character.id },
    input: { characterId: character.id },
    idempotencyKey: `${CHARACTER_AVATAR_KIND}:${character.id}`,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

type RawCharacter = {
  displayName?: unknown;
  type?: unknown;
  pronouns?: unknown;
  description?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** A short noun for the character, so the model draws a person, a pet or a toy. */
function subjectOf(type: string | null, pronouns: string | null): string {
  if (type === 'Pet') return 'a pet';
  if (type === 'Toy') return 'a toy';
  if (pronouns === 'he/him') return 'a boy';
  if (pronouns === 'she/her') return 'a girl';
  return 'a character';
}

/** The avatar prompt from a character's words. Exported for tests. */
export function buildAvatarPrompt(character: RawCharacter): string {
  const name = str(character.displayName) ?? 'a friend';
  const subject = subjectOf(str(character.type), str(character.pronouns));
  const description = str(character.description);
  const lines = [
    `A friendly head-and-shoulders avatar portrait of ${name}, ${subject} in a children's storybook.`,
  ];
  if (description) lines.push(`Appearance: ${description}.`);
  lines.push(
    'Warm, colourful storybook illustration with soft lighting, a gentle happy expression and a simple plain background.',
    'Centred, facing the viewer. Do not put any text, words, letters or captions in the image.'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const IMAGE_REJECTED = /did not match the expected pattern|INVALID_ARGUMENT|SAFETY|blocked|recitation/i;

/** An image the model would not draw is worth another attempt (as the Book art jobs treat it). */
function asImageFailure(error: unknown): unknown {
  if (error instanceof JobFailure) return error;
  const message = (error as Error)?.message ?? String(error);
  if (error instanceof NoImageReturnedError || IMAGE_REJECTED.test(message)) {
    return new JobFailure('IMAGE_REJECTED', message, { retryable: true, cause: error });
  }
  return error;
}

function isFinalAttempt(job: WithId<Job>, error: unknown): boolean {
  const classified = toJobError(error);
  return !classified.retryable || job.attempt >= job.maxAttempts;
}

function avatarHandler(getDeps: () => Promise<CharacterAvatarDeps>): JobDefinition['run'] {
  return async (ctx) => {
    const { characterId } = ctx.job.input as { characterId: string };
    const ref = ctx.db.collection(CHARACTERS).doc(characterId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return; // the character was deleted; nothing to draw
    const data = snapshot.data() as RawCharacter & { avatarUrl?: unknown; avatarGeneration?: { jobId?: string; status?: string } };
    // A retry that already produced our avatar stops.
    if (data.avatarUrl && data.avatarGeneration?.jobId === ctx.job.jobId && data.avatarGeneration?.status === 'ready') return;

    const stamp = () => FieldValue.serverTimestamp();
    await ref.update({ avatarGeneration: { status: 'running', jobId: ctx.job.jobId, updatedAt: stamp() }, updatedAt: stamp() });

    const deps = await getDeps();
    let avatarUrl: string;
    if (deps.testMode()) {
      avatarUrl = TEST_MODE_IMAGE_DATA_URL;
    } else {
      try {
        const { mediaUrl } = await deps.ai.generateImage({
          purpose: 'character.avatar',
          flowName: 'character.avatar',
          ownerUid: ctx.job.ownerUid,
          prompt: [{ text: buildAvatarPrompt(data) }],
          config: { imageConfig: { aspectRatio: '1:1' } },
        });
        const { contentType, data: bytes } = await decodeMedia(mediaUrl);
        const stored = await deps.blobs.save(
          `characters/${characterId}/avatar/${ctx.job.jobId}-${ctx.job.attempt}.${extensionFor(contentType)}`,
          bytes,
          contentType,
          { characterId, ownerUid: ctx.job.ownerUid }
        );
        avatarUrl = stored.url;
      } catch (error) {
        const failure = asImageFailure(error);
        if (isFinalAttempt(ctx.job, failure)) {
          await ref
            .update({ avatarGeneration: { status: 'failed', jobId: ctx.job.jobId, updatedAt: stamp() }, updatedAt: stamp() })
            .catch(() => undefined);
        }
        throw failure;
      }
    }
    await ref.update({ avatarUrl, avatarGeneration: { status: 'ready', jobId: ctx.job.jobId, updatedAt: stamp() }, updatedAt: stamp() });
  };
}

/** Register the `character.avatar` kind. `getDeps` is called when a job runs (not at import). */
export function registerCharacterJobs(registry: JobRegistry, getDeps: () => Promise<CharacterAvatarDeps>): JobRegistry {
  return registry.register({ kind: CHARACTER_AVATAR_KIND, queue: 'ai-image', maxAttempts: 3, run: avatarHandler(getDeps) });
}

let defaults: CharacterAvatarDeps | null = null;

/** Production dependencies: the shared AI harness, Firebase Storage, env TEST_MODE. */
export async function defaultCharacterJobDeps(): Promise<CharacterAvatarDeps> {
  if (defaults) return defaults;
  const [{ getAIHarness }, { isTestMode }] = await Promise.all([import('../ai/harness'), import('@/lib/test-mode')]);
  defaults = { ai: getAIHarness(), blobs: firebaseBlobStore, testMode: () => isTestMode(), now: () => new Date() };
  return defaults;
}
