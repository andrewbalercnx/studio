/**
 * `story.finish` (pipeline.md): every mode ends here — no mode skips it any
 * more (today Wizard and Friends never reached compile).
 *
 *   title + synopsis (port of storyCompileFlow's generateSynopsis and
 *   storyTitleFlow; a title the mode proposed is kept)
 *   → ONE transaction: Story `complete` + one `story_allowance` unit consumed.
 *
 * Idempotent: the allowance is charged only by the transaction that moves the
 * Story from `finishing` to `complete`, so a re-run (or a retry after a crash)
 * never charges twice. When the family has run out between starting and
 * finishing, the Story still completes (as today's compile: "a finished story
 * is never failed by the ledger") and `allowance.charged` is false.
 *
 * On the last attempt (or a non-retryable error) the Story becomes `failed`;
 * `POST /api/stories/{id}/finish` moves it back to `finishing` with a new job.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { AIHarness } from '../ai/harness';
import { stories } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { Job } from '../data/schemas/job';
import { JobFailure, type JobDefinition, type JobRegistry, type JobSpec } from '../jobs/registry';
import { toJobError } from '../jobs/runner';
import { chargeAllowance, readLedgerIn } from '../books/allowance';
import { loadFamilyRoster } from './context';
import { renderCastTokens } from './tokens';

export const STORY_FINISH_KIND = 'story.finish';

export type FinishDeps = {
  ai: Pick<AIHarness, 'generateText'>;
  /** TEST_MODE: deterministic title and synopsis, no model call. */
  testMode: () => boolean;
  now: () => Date;
};

/** The job for finishing run `run` (1 = the first; a retry after `failed` is a new job). */
export function finishSpec(story: { id: string; ownerUid: string }, run: number): JobSpec {
  return {
    kind: STORY_FINISH_KIND,
    ownerUid: story.ownerUid,
    target: { collection: 'stories', id: story.id },
    input: { storyId: story.id, run },
    // Keyed by the story id (pipeline.md); a retry run gets its own key.
    idempotencyKey: run <= 1 ? `${STORY_FINISH_KIND}:${story.id}` : `${STORY_FINISH_KIND}:${story.id}:run-${run}`,
  };
}

function isFinalAttempt(job: WithId<Job>, error: unknown): boolean {
  return !toJobError(error).retryable || job.attempt >= job.maxAttempts;
}

/** Today's synopsis prompt (storyCompileFlow.generateSynopsis), on the text as the child reads it. */
export function synopsisPrompt(storyText: string): string {
  return `You are writing a brief summary for parents to see on their child's story card.

STORY TO SUMMARIZE:
${storyText}

INSTRUCTIONS:
Write exactly 1-2 complete sentences summarizing this children's story for parents.

Requirements:
- Capture the main adventure or heartwarming moment
- Be engaging and help parents quickly understand the story
- Be suitable for display on a story card

Output format:
- Return ONLY the summary text with no labels, prefixes, or formatting
- Your response must be grammatically complete sentences
- End with proper punctuation (period)

Example of correct output:
A young explorer and their animal friend discover a hidden treasure while learning the importance of teamwork and courage.

Now write the summary:`;
}

/** Today's title prompt (storyTitleFlow). */
export function titlePrompt(synopsis: string, childAge: number | null): string {
  return `Generate a short, catchy title for this children's story.

STORY SYNOPSIS:
${synopsis}

The title should be suitable for a ${childAge ? `aged ${childAge}` : 'young'} child, fun and engaging, and capture the main theme or adventure. You may include a character's name if appropriate.

Reply with ONLY the title text, nothing else.`;
}

export function tidySynopsis(raw: string): string {
  let synopsis = raw.trim();
  if (synopsis && !/[.!?]$/.test(synopsis)) {
    synopsis = synopsis.length > 20 ? `${synopsis}.` : 'A delightful adventure story for young readers.';
  }
  return synopsis.length >= 10 ? synopsis : 'A delightful adventure story for young readers.';
}

export function tidyTitle(raw: string): string {
  let title = raw.trim().split('\n')[0]?.trim() || 'My Story';
  if ((title.startsWith('"') && title.endsWith('"')) || (title.startsWith("'") && title.endsWith("'"))) title = title.slice(1, -1).trim();
  return title || 'My Story';
}

async function failStory(db: Firestore, storyId: string, error: unknown): Promise<void> {
  const repo = stories.using(db);
  const jobError = toJobError(error);
  await db.runTransaction(async (tx) => {
    const story = await repo.getIn(tx, storyId);
    if (!story || story.status !== 'finishing') return;
    await repo.updateIn(tx, storyId, { status: 'failed', error: { code: jobError.code, message: 'The story could not be finished. Try again.' } });
  });
}

function finishHandler(getDeps: () => Promise<FinishDeps>): JobDefinition['run'] {
  return async (ctx) => {
    const { storyId } = ctx.job.input as { storyId: string };
    const repo = stories.using(ctx.db);
    const story = await repo.get(storyId);
    if (!story || story.status !== 'finishing') return; // complete already, abandoned, or failed and not retried
    const deps = await getDeps();

    let title: string;
    let synopsis: string;
    try {
      if (!story.text?.trim()) throw new JobFailure('STORY_EMPTY', 'The story has no text', { retryable: false });
      const family = await loadFamilyRoster(ctx.db, story.ownerUid, story.childId, deps.now()).catch((error) => {
        throw new JobFailure('CHILD_NOT_FOUND', (error as Error).message, { retryable: false });
      });
      const names = new Map(family.people.map((p) => [p.castId, p.displayName]));
      const readable = renderCastTokens(story.text, (id) => names.get(id) ?? null);
      if (deps.testMode()) {
        synopsis = `${family.hero.displayName} has a wonderful adventure.`;
        title = story.titleHint ?? `${family.hero.displayName}'s Story`;
      } else {
        // Title and synopsis summarise finished text: a cheap model by purpose,
        // not the creation mode's conversational model.
        const call = (flowName: string, prompt: string, config: Record<string, unknown>) =>
          deps.ai.generateText({
            purpose: 'story.finish',
            flowName,
            ownerUid: story.ownerUid,
            prompt,
            config,
          });
        synopsis = tidySynopsis((await call('story.finish.synopsis', synopsisPrompt(readable), { temperature: 0.3, maxOutputTokens: 200 })).text ?? '');
        title = story.titleHint
          ? story.titleHint
          : tidyTitle((await call('story.finish.title', titlePrompt(synopsis, family.childAge), { temperature: 0.8, maxOutputTokens: 50 })).text ?? '');
      }
    } catch (error) {
      if (isFinalAttempt(ctx.job, error)) await failStory(ctx.db, storyId, error);
      throw error;
    }

    const now = deps.now();
    await ctx.db.runTransaction(async (tx) => {
      const current = await repo.requireIn(tx, storyId);
      if (current.status !== 'finishing') return;
      const ledger = await readLedgerIn(tx, ctx.db, current.ownerUid);
      const charge = chargeAllowance(tx, ledger, 'story_allowance', current.ownerUid, current.childId, now);
      if (charge.allowed) charge.write();
      else console.warn(`[creation] story ${storyId} completed without allowance: ${charge.reason}`);
      await repo.updateIn(tx, storyId, {
        status: 'complete',
        title,
        synopsis,
        error: null,
        completedAt: FieldValue.serverTimestamp(),
        allowance: { charged: charge.allowed, remaining: charge.remaining, reason: charge.allowed ? null : charge.reason },
      });
    });
  };
}

export function registerCreationJobs(registry: JobRegistry, getDeps: () => Promise<FinishDeps>): JobRegistry {
  return registry.register({ kind: STORY_FINISH_KIND, queue: 'ai-text', maxAttempts: 3, run: finishHandler(getDeps) });
}
