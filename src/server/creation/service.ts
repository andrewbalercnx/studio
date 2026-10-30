/**
 * Creation services behind the three routes (creation.md "One route, one flow
 * of control"), plus retrying a failed finish:
 *
 *   createStory   POST /api/stories                 child + mode + allowance check → Story + first turn
 *   submitTurn    POST /api/stories/{id}/turns      input → reply (or done → finishing + story.finish)
 *   abandonStory  POST /api/stories/{id}/abandon
 *   retryFinish   POST /api/stories/{id}/finish     failed → finishing (new story.finish job);
 *                                                     finishing → re-dispatch its job if still queued
 *
 * Concurrency of turns: a turn is claimed in a transaction keyed by the
 * request's idempotency key (`Story.pendingTurn`, with a lease), the engine
 * runs outside any transaction (model calls take seconds), and the result is
 * committed in a second transaction that checks the claim is still ours. A
 * repeat of a recorded key returns the recorded reply; a different turn while
 * one is in flight gets 409 TURN_CONFLICT; a repeat of the in-flight key gets
 * 409 TURN_IN_PROGRESS (the client retries and then receives the reply).
 */
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { enforcePersonaScope } from '@/lib/persona.server';
import { checkAllowance } from '../books/allowance';
import { stories, storyTurns } from '../data/repositories';
import type { CreateInput, WithId } from '../data/repository';
import {
  turnDocId,
  type CastMember,
  type ChildInput,
  type CreationModeId,
  type Story,
  type StoryTurn,
  type turnSchema,
} from '../data/schemas/story';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, PaymentRequiredError } from '../errors';
import { assertOwner, isPrivileged, type VerifiedUser } from '../http';
import { isTargetStory } from '../books/story-source';
import type { JobRunner } from '../jobs/runner';
import { buildStoryContext, displayText, type StoryContext, type StoryContextInput } from './context';
import { isDone, type CreationModeEngine, type Done, type NewCastMember, type Turn } from './engine';
import { createEngines, type EngineSetDeps } from './engines';
import { finishSpec } from './finish';
import { loadCreationMode, modeAvailability, type CreationMode } from './modes';
import { loadStoryType } from './story-types';
import { extractCastIds } from './tokens';

export type CreationServiceDeps = {
  db: Firestore;
  runner: Pick<JobRunner, 'enqueueInTransaction'>;
  engines: EngineSetDeps;
  now?: () => Date;
  /** How long a claimed turn blocks others if its request dies (default 4 minutes). */
  turnLeaseMs?: number;
};

const DEFAULT_TURN_LEASE_MS = 4 * 60_000;
const CHARACTERS = 'characters';

function sha(text: string, length = 24): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

/** A Story created with a client key gets a derived id, so a repeat returns it. */
export function storyIdFor(ownerUid: string, idempotencyKey: string): string {
  return `st_${sha(`${ownerUid}|${idempotencyKey}`)}`;
}

function nowOf(deps: CreationServiceDeps): Date {
  return deps.now ? deps.now() : new Date();
}

// ---------------------------------------------------------------------------
// What the routes return
// ---------------------------------------------------------------------------

export type TurnView = {
  index: number;
  kind: StoryTurn['kind'];
  prompt: string | null;
  promptDisplay: string | null;
  options: Array<{ id: string; text: string; display: string; preselected: boolean }> | null;
  expects: StoryTurn['expects'];
  progress: StoryTurn['progress'];
  addedCast: string[];
};

export type StoryTurnResult = {
  storyId: string;
  status: Story['status'];
  turn: TurnView;
  /** False when this was a repeat of an earlier request (same idempotency key). */
  created: boolean;
};

function view(turn: Pick<StoryTurn, 'index' | 'kind' | 'prompt' | 'promptDisplay' | 'options' | 'expects' | 'progress' | 'addedCast'>): TurnView {
  return {
    index: turn.index,
    kind: turn.kind,
    prompt: turn.prompt,
    promptDisplay: turn.promptDisplay,
    options: turn.options?.map((o) => ({ id: o.id, text: o.text, display: o.display, preselected: o.preselected ?? false })) ?? null,
    expects: turn.expects,
    progress: turn.progress,
    addedCast: turn.addedCast,
  };
}

// ---------------------------------------------------------------------------
// Turning an engine result into documents
// ---------------------------------------------------------------------------

type TurnData = CreateInput<typeof turnSchema>;

type Recorded = {
  reply: TurnData;
  cast: CastMember[];
  newCharacters: Array<{ id: string; data: Record<string, unknown> }>;
  done: Done | null;
};

/** Apply the engine's cast changes (owner-scoped) to `base` and build the reply turn. */
function record(
  ctx: StoryContext,
  base: CastMember[],
  result: Turn | Done,
  meta: { index: number; idempotencyKey: string }
): Recorded {
  const stored = new Map<string, CastMember>(base.map((m) => [m.castId, m]));
  const added: string[] = [];
  const newCharacters: Recorded['newCharacters'] = [];

  const join = (member: CastMember) => {
    if (stored.has(member.castId)) return;
    stored.set(member.castId, member);
    added.push(member.castId);
  };

  const addCast: NewCastMember[] = result.addCast ?? [];
  for (const entry of addCast) {
    if (entry.kind === 'existing') {
      const person = ctx.roster.find((p) => p.castId === entry.castId);
      if (!person || person.isHero) continue;
      join({ castId: entry.castId, ref: person.ref, role: 'supporting', addedBy: entry.addedBy });
    } else {
      join({ castId: entry.castId, ref: { kind: 'character', id: entry.castId }, role: 'supporting', addedBy: 'ai' });
      const c = entry.character;
      newCharacters.push({
        id: entry.castId,
        data: {
          id: entry.castId,
          ownerParentUid: ctx.ownerUid,
          childId: ctx.childId,
          displayName: c.displayName,
          pronouns: c.pronouns,
          type: c.type,
          description: c.description,
          dateOfBirth: c.dateOfBirth ? Timestamp.fromDate(new Date(c.dateOfBirth)) : null,
          likes: c.likes,
          dislikes: c.dislikes,
          photos: [],
          origin: 'story',
          originStoryId: ctx.storyId,
          isParentGenerated: false,
          usageCount: 1,
          lastUsedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  if (isDone(result)) {
    // The final cast is who the final text names: the hero, family members the
    // text mentions (they join now), and earlier cast members still in it.
    const named = new Set(extractCastIds(result.text));
    for (const castId of named) {
      const person = ctx.roster.find((p) => p.castId === castId);
      if (person && !person.isHero) join({ castId, ref: person.ref, role: 'supporting', addedBy: 'ai' });
    }
    return {
      reply: {
        ownerUid: ctx.ownerUid,
        childId: ctx.childId,
        index: meta.index,
        role: 'ai',
        kind: 'done',
        idempotencyKey: meta.idempotencyKey,
        addedCast: added.filter((id) => named.has(id)),
      },
      cast: [...stored.values()].filter((m) => m.role === 'hero' || named.has(m.castId)),
      newCharacters,
      done: result,
    };
  }

  const options = result.options?.map((o) => ({ id: o.id, text: o.text, display: displayText(ctx, o.text), preselected: o.preselected ?? false })) ?? null;
  return {
    reply: {
      ownerUid: ctx.ownerUid,
      childId: ctx.childId,
      index: meta.index,
      role: 'ai',
      kind: 'prompt',
      idempotencyKey: meta.idempotencyKey,
      prompt: result.prompt,
      promptDisplay: displayText(ctx, result.prompt),
      options,
      expects: result.expects ?? (options && options.length > 0 ? 'choice' : 'text'),
      progress: result.progress ? { step: result.progress.step, of: result.progress.of ?? null } : null,
      addedCast: added,
    },
    cast: [...stored.values()],
    newCharacters,
    done: null,
  };
}

/** The child's input as words, from the prompt it answers. */
function inputDisplay(ctx: StoryContext, input: ChildInput): string {
  if (input.kind === 'text') return input.text.trim();
  const last = [...ctx.turns].reverse().find((t) => t.kind === 'prompt');
  if (input.kind === 'choice') return last?.options?.find((o) => o.id === input.optionId)?.display ?? input.optionId;
  const names = input.castIds.map((id) => ctx.roster.find((p) => p.castId === id)?.displayName).filter(Boolean);
  return names.join(', ');
}

/** Create AI-introduced characters inside the turn's transaction (reads first, then `write`). */
async function prepareCharacters(tx: Transaction, db: Firestore, characters: Recorded['newCharacters']) {
  const refs: DocumentReference[] = characters.map((c) => db.collection(CHARACTERS).doc(c.id));
  const snapshots = refs.length > 0 ? await tx.getAll(...refs) : [];
  return () => {
    characters.forEach((c, i) => {
      if (!snapshots[i].exists) tx.set(refs[i], c.data);
    });
  };
}

// ---------------------------------------------------------------------------
// POST /api/stories
// ---------------------------------------------------------------------------

export type CreateStoryInput = {
  childId: string;
  modeId: CreationModeId;
  castIds?: string[];
  storyTypeId?: string | null;
  idempotencyKey: string;
};

async function personaOf(user: VerifiedUser, ownerUid: string, childId: string): Promise<boolean> {
  const persona = await enforcePersonaScope({
    expectedUid: ownerUid,
    effectiveChildId: childId,
    claims: user.claims as unknown as Record<string, unknown>,
  });
  if (!persona.ok) throw new ForbiddenError(persona.message, { code: persona.code });
  return persona.persona !== null && persona.persona !== undefined;
}

async function existingResult(db: Firestore, story: WithId<Story>, idempotencyKey: string): Promise<StoryTurnResult> {
  const turns = await storyTurns.using(db).of(story.id).where({ idempotencyKey });
  const reply = turns.filter((t) => t.role === 'ai').sort((a, b) => b.index - a.index)[0];
  if (!reply) throw new ConflictError('This story is still being set up; try again.', { code: 'TURN_IN_PROGRESS' });
  return { storyId: story.id, status: story.status, turn: view(reply), created: false };
}

export async function createStory(deps: CreationServiceDeps, user: VerifiedUser, body: CreateStoryInput): Promise<StoryTurnResult> {
  const { db } = deps;
  const now = nowOf(deps);

  // The child: the caller's (admins and writers act for any family), in the persona's scope.
  const childSnap = await db.collection('children').doc(body.childId).get();
  const child = childSnap.data();
  if (!childSnap.exists || !child || (child.deletedAt !== undefined && child.deletedAt !== null) || typeof child.ownerParentUid !== 'string') {
    throw new NotFoundError('Child not found', { code: 'CHILD_NOT_FOUND', details: { childId: body.childId } });
  }
  const ownerUid = child.ownerParentUid as string;
  await assertOwner(user, { ownerUid, childId: body.childId }, 'Child');
  const childPersona = await personaOf(user, ownerUid, body.childId);

  // The mode: live, and enabled for kids when a child persona is active.
  const mode = await loadCreationMode(db, body.modeId);
  if (!mode) throw new NotFoundError('Mode not found', { code: 'MODE_NOT_FOUND', details: { modeId: body.modeId } });
  const available = modeAvailability(mode, { privileged: isPrivileged(user), childPersona });
  if (!available.ok) throw new ForbiddenError(available.message, { code: available.code });

  // A repeat of the same request returns the same Story and first turn.
  const storyId = storyIdFor(ownerUid, body.idempotencyKey);
  const repo = stories.using(db);
  const existing = await repo.get(storyId);
  if (existing) {
    if (existing.childId !== body.childId || existing.modeId !== body.modeId) {
      throw new ConflictError('This idempotency key was used for another story', { code: 'IDEMPOTENCY_KEY_REUSED' });
    }
    return existingResult(db, existing, body.idempotencyKey);
  }

  // The story allowance must be available (check only; story.finish consumes it).
  const allowance = await checkAllowance(db, 'story_allowance', ownerUid, body.childId, now);
  if (!allowance.allowed) {
    throw new PaymentRequiredError("You've used all your stories. Ask a grown-up to add more to keep creating!", {
      code: 'ENTITLEMENT_LIMIT',
      details: { remaining: allowance.remaining },
    });
  }

  let storyTypeId: string | null = null;
  if (body.storyTypeId) {
    if (body.modeId !== 'adventure') throw new BadRequestError('Only the adventure mode takes a story type', { code: 'INVALID_BODY' });
    const type = await loadStoryType(db, body.storyTypeId);
    if (!type || (type.status !== 'live' && !isPrivileged(user))) {
      throw new NotFoundError('Story type not found', { code: 'STORY_TYPE_NOT_FOUND', details: { storyTypeId: body.storyTypeId } });
    }
    storyTypeId = type.storyTypeId;
  }

  // Cast: the hero, then the chosen family members (owner-scoped).
  const heroMember: CastMember = { castId: body.childId, ref: { kind: 'child', id: body.childId }, role: 'hero', addedBy: 'setup' };
  const input: StoryContextInput = {
    storyId,
    ownerUid,
    childId: body.childId,
    modeId: body.modeId,
    status: 'creating',
    storyTypeId,
    cast: [heroMember],
    modeState: {},
    turnCount: 0,
  };
  const engineDeps = { config: deps.engines.config, now: () => now };
  const ctx = await buildStoryContext(db, input, mode, engineDeps, { turns: [] });
  const castIds = [...new Set(body.castIds ?? [])].filter((id) => id !== body.childId);
  for (const castId of castIds) {
    const person = ctx.roster.find((p) => p.castId === castId);
    if (!person) throw new BadRequestError('A chosen character is not in this family', { code: 'CAST_NOT_FOUND', details: { castId } });
    ctx.castMembers = [...ctx.castMembers, { castId, ref: person.ref, role: 'supporting', addedBy: 'setup' }];
    ctx.cast.push(person);
  }

  const engine = engineFor(deps, mode);
  const turn = await engine.start(ctx);
  if (isDone(turn as Turn | Done)) throw new ConflictError('The mode ended before it started', { code: 'MODE_ERROR' });
  const recorded = record(ctx, ctx.castMembers, turn, { index: 0, idempotencyKey: body.idempotencyKey });

  const outcome = await db.runTransaction(async (tx) => {
    const raced = await repo.getIn(tx, storyId);
    if (raced) return { raced };
    const writeCharacters = await prepareCharacters(tx, db, recorded.newCharacters);
    writeCharacters();
    await repo.createIn(
      tx,
      {
        ownerUid,
        childId: body.childId,
        modeId: body.modeId,
        storyTypeId: (ctx.modeState.storyTypeId as string | undefined) ?? storyTypeId,
        cast: recorded.cast,
        status: 'creating',
        modeState: ctx.modeState,
        turnCount: 1,
        idempotencyKey: body.idempotencyKey,
      },
      { id: storyId }
    );
    await storyTurns.using(db).of(storyId).createIn(tx, recorded.reply, { id: turnDocId(0) });
    return { raced: null };
  });
  if (outcome.raced) return existingResult(db, outcome.raced, body.idempotencyKey);
  return { storyId, status: 'creating', turn: view({ ...defaultsOf(recorded.reply) }), created: true };
}

/** A reply turn as stored (schema defaults applied) for the response. */
function defaultsOf(reply: TurnData): StoryTurn {
  const options = reply.options?.map((o) => ({ ...o, preselected: o.preselected ?? false })) ?? null;
  return {
    prompt: null,
    promptDisplay: null,
    expects: null,
    progress: null,
    addedCast: [],
    input: null,
    inputDisplay: null,
    idempotencyKey: null,
    ...reply,
    options,
  } as StoryTurn;
}

function engineFor(deps: CreationServiceDeps, mode: CreationMode): CreationModeEngine {
  return createEngines(deps.engines)[mode.modeId];
}

/**
 * The caller's target Story (owner + persona). A legacy `stories` document
 * (today's flows) is not a Story these routes act on: 404, not a schema error.
 */
async function loadOwnedStory(db: Firestore, user: VerifiedUser, storyId: string): Promise<WithId<Story>> {
  if (!storyId || storyId.includes('/')) throw new BadRequestError('Missing story id');
  const snapshot = await db.collection('stories').doc(storyId).get();
  if (!snapshot.exists || !isTargetStory(snapshot.data())) {
    throw new NotFoundError('Story not found', { code: 'STORY_NOT_FOUND', details: { id: storyId } });
  }
  const story = stories.using(db).parse(snapshot);
  await assertOwner(user, story, 'Story');
  return story;
}

// ---------------------------------------------------------------------------
// POST /api/stories/{storyId}/turns
// ---------------------------------------------------------------------------

export type SubmitTurnInput = { input: ChildInput; idempotencyKey: string };

async function replyFor(db: Firestore, storyId: string, idempotencyKey: string, tx?: Transaction): Promise<WithId<StoryTurn> | null> {
  const repo = storyTurns.using(db).of(storyId);
  let turns: WithId<StoryTurn>[];
  if (tx) {
    const snapshot = await tx.get((await repo.collection()).where('idempotencyKey', '==', idempotencyKey));
    turns = snapshot.docs.map((doc) => repo.parse(doc));
  } else {
    turns = await repo.where({ idempotencyKey });
  }
  return turns.filter((t) => t.role === 'ai').sort((a, b) => b.index - a.index)[0] ?? null;
}

export async function submitTurn(deps: CreationServiceDeps, user: VerifiedUser, storyId: string, body: SubmitTurnInput): Promise<StoryTurnResult> {
  const { db } = deps;
  const repo = stories.using(db);
  await loadOwnedStory(db, user, storyId);
  const key = body.idempotencyKey;

  // 1. Claim the turn (or return the recorded reply of a repeat).
  const leaseMs = deps.turnLeaseMs ?? DEFAULT_TURN_LEASE_MS;
  const claim = await db.runTransaction(async (tx) => {
    const story = await repo.requireIn(tx, storyId);
    const recorded = await replyFor(db, storyId, key, tx);
    if (recorded) return { kind: 'repeat' as const, story, reply: recorded };
    if (story.status !== 'creating') {
      throw new ConflictError('This story is not being created any more', { code: 'STORY_NOT_CREATING', details: { status: story.status } });
    }
    const nowMs = nowOf(deps).getTime();
    if (story.pendingTurn && story.pendingTurn.leaseUntil.toMillis() > nowMs) {
      if (story.pendingTurn.idempotencyKey === key) {
        throw new ConflictError('This answer is still being worked on', { code: 'TURN_IN_PROGRESS' });
      }
      throw new ConflictError('Another answer is being worked on', { code: 'TURN_CONFLICT' });
    }
    await repo.updateIn(tx, storyId, { pendingTurn: { idempotencyKey: key, leaseUntil: Timestamp.fromMillis(nowMs + leaseMs) } });
    return { kind: 'claimed' as const, story };
  });
  if (claim.kind === 'repeat') return { storyId, status: claim.story.status, turn: view(claim.reply), created: false };
  const story = claim.story;

  const release = () =>
    db
      .runTransaction(async (tx) => {
        const current = await repo.getIn(tx, storyId);
        if (current?.pendingTurn?.idempotencyKey === key) await repo.updateIn(tx, storyId, { pendingTurn: null });
      })
      .catch((error) => console.error('[creation] Failed to release turn claim', storyId, error));

  // 2. Run the engine outside any transaction.
  let recorded: Recorded;
  let ctx: StoryContext;
  try {
    const mode = await loadCreationMode(db, story.modeId);
    if (!mode) throw new NotFoundError('Mode not found', { code: 'MODE_NOT_FOUND' });
    const now = nowOf(deps);
    ctx = await buildStoryContext(
      db,
      {
        storyId,
        ownerUid: story.ownerUid,
        childId: story.childId,
        modeId: story.modeId,
        status: story.status,
        storyTypeId: story.storyTypeId,
        cast: story.cast,
        modeState: story.modeState,
        turnCount: story.turnCount,
      },
      mode,
      { config: deps.engines.config, now: () => now }
    );
    const result = await engineFor(deps, mode).respond(ctx, body.input);
    recorded = record(ctx, story.cast, result, { index: story.turnCount + 1, idempotencyKey: key });
  } catch (error) {
    await release();
    throw error;
  }

  const inputTurn: TurnData = {
    ownerUid: story.ownerUid,
    childId: story.childId,
    index: story.turnCount,
    role: 'child',
    kind: 'input',
    idempotencyKey: key,
    input: body.input,
    inputDisplay: inputDisplay(ctx, body.input),
  };

  // 3. Commit the input, the reply, cast changes and (on done) the move to finishing.
  const turnRepo = storyTurns.using(db).of(storyId);
  const outcome = await db.runTransaction(async (tx) => {
    const current = await repo.requireIn(tx, storyId);
    if (current.pendingTurn?.idempotencyKey !== key || current.turnCount !== story.turnCount || current.status !== 'creating') {
      throw new ConflictError('Another answer was recorded first', { code: 'TURN_CONFLICT' });
    }
    const writeCharacters = await prepareCharacters(tx, db, recorded.newCharacters);
    const run = current.finishRuns + 1;
    const pending = recorded.done ? await deps.runner.enqueueInTransaction(tx, [finishSpec({ id: storyId, ownerUid: story.ownerUid }, run)]) : null;

    writeCharacters();
    await turnRepo.createIn(tx, inputTurn, { id: turnDocId(story.turnCount) });
    await turnRepo.createIn(tx, recorded.reply, { id: turnDocId(story.turnCount + 1) });
    const storyTypeId = (ctx.modeState.storyTypeId as string | undefined) ?? current.storyTypeId;
    await repo.updateIn(tx, storyId, {
      cast: recorded.cast,
      modeState: ctx.modeState,
      turnCount: story.turnCount + 2,
      pendingTurn: null,
      storyTypeId,
      ...(recorded.done
        ? {
            status: 'finishing' as const,
            text: recorded.done.text,
            titleHint: recorded.done.titleHint?.trim() || null,
            finishRuns: run,
            finishJobId: pending?.jobs[0]?.jobId ?? null,
          }
        : {}),
    });
    return { pending };
  });
  await outcome.pending?.dispatch();
  return {
    storyId,
    status: recorded.done ? 'finishing' : 'creating',
    turn: view(defaultsOf(recorded.reply)),
    created: true,
  };
}

// ---------------------------------------------------------------------------
// POST /api/stories/{storyId}/abandon and /finish
// ---------------------------------------------------------------------------

export async function abandonStory(deps: CreationServiceDeps, user: VerifiedUser, storyId: string): Promise<{ storyId: string; status: Story['status'] }> {
  const repo = stories.using(deps.db);
  await loadOwnedStory(deps.db, user, storyId);
  return deps.db.runTransaction(async (tx) => {
    const story = await repo.requireIn(tx, storyId);
    if (story.status === 'abandoned') return { storyId, status: story.status };
    if (story.status !== 'creating') {
      throw new ConflictError('Only a story being created can be abandoned', { code: 'STORY_NOT_CREATING', details: { status: story.status } });
    }
    await repo.updateIn(tx, storyId, { status: 'abandoned', pendingTurn: null, abandonedAt: FieldValue.serverTimestamp() });
    return { storyId, status: 'abandoned' as const };
  });
}

export async function retryFinish(deps: CreationServiceDeps, user: VerifiedUser, storyId: string): Promise<{ storyId: string; status: Story['status'] }> {
  const repo = stories.using(deps.db);
  await loadOwnedStory(deps.db, user, storyId);
  const outcome = await deps.db.runTransaction(async (tx) => {
    const story = await repo.requireIn(tx, storyId);
    if (story.status === 'complete') return { status: story.status, pending: null };
    if (story.status === 'finishing') {
      // Same run, same idempotency key: no new job. A job still `queued` (its
      // dispatch was lost) is dispatched again; a running or finished one is left alone.
      const pending = await deps.runner.enqueueInTransaction(tx, [finishSpec({ id: storyId, ownerUid: story.ownerUid }, story.finishRuns)]);
      return { status: story.status, pending };
    }
    if (story.status !== 'failed') {
      throw new ConflictError('Only a story that failed to finish can be retried', { code: 'STORY_NOT_FAILED', details: { status: story.status } });
    }
    const run = story.finishRuns + 1;
    const pending = await deps.runner.enqueueInTransaction(tx, [finishSpec({ id: storyId, ownerUid: story.ownerUid }, run)]);
    await repo.updateIn(tx, storyId, { status: 'finishing', error: null, finishRuns: run, finishJobId: pending.jobs[0]?.jobId ?? null });
    return { status: 'finishing' as const, pending };
  });
  await outcome.pending?.dispatch();
  return { storyId, status: outcome.status };
}
