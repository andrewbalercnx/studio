/**
 * What clients read about Stories through the API (slice 5.4): a Story with
 * every text rendered as the child reads it (names, no cast tokens), its cast
 * with names and avatars, and its turns as the play screens need them.
 *
 *   GET /api/stories?childId=…   listStoriesForChild  (newest first, abandoned left out)
 *   GET /api/stories/{storyId}   getStoryWithTurns
 *   GET /api/creation-modes      listChoosableModes
 *
 * The web app reads `stories/{id}` and its `turns` with read-only listeners
 * while a Story is being created (owner-read rules); mobile and the readers
 * use these routes. Names are resolved here, never on a client.
 */
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { stories } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { CreationModeId, Story, StoryStatus, StoryTurn } from '../data/schemas/story';
import { BadRequestError, NotFoundError } from '../errors';
import { assertOwner, type VerifiedUser } from '../http';
import { isTargetStory } from '../books/story-source';
import { loadTurns } from './context';
import { listCreationModes, type CreationMode } from './modes';
import { HERO_ALIASES, normalizeModelText, renderCastTokens } from './tokens';

export type StoryCastView = {
  castId: string;
  kind: 'child' | 'character';
  role: 'hero' | 'supporting';
  displayName: string;
  avatarUrl: string | null;
};

export type StoryView = {
  id: string;
  childId: string;
  modeId: CreationModeId;
  storyTypeId: string | null;
  status: StoryStatus;
  /** Names resolved (what the child reads); null until `story.finish` has run. */
  title: string | null;
  synopsis: string | null;
  /** The finished text with names; null while the Story is being created. */
  text: string | null;
  cast: StoryCastView[];
  turnCount: number;
  error: { code: string; message: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

export type StoryTurnReadView = {
  index: number;
  role: StoryTurn['role'];
  kind: StoryTurn['kind'];
  promptDisplay: string | null;
  options: Array<{ id: string; display: string; preselected: boolean }> | null;
  expects: StoryTurn['expects'];
  progress: StoryTurn['progress'];
  inputDisplay: string | null;
  addedCast: string[];
};

export type CreationModeView = {
  modeId: CreationModeId;
  name: string;
  description: string;
  icon: string | null;
  gradient: string | null;
  darkGradient: string | null;
  loadingMessage: string | null;
  recommended: boolean;
};

// ---------------------------------------------------------------------------
// People (owner-scoped) and rendering
// ---------------------------------------------------------------------------

type Person = { id: string; kind: 'child' | 'character'; displayName: string; avatarUrl: string | null };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** The owner's children and characters (deleted ones too: a finished story keeps its names). */
async function loadPeople(db: Firestore, ownerUid: string): Promise<Map<string, Person>> {
  const [children, characters] = await Promise.all([
    db.collection('children').where('ownerParentUid', '==', ownerUid).get(),
    db.collection('characters').where('ownerParentUid', '==', ownerUid).get(),
  ]);
  const people = new Map<string, Person>();
  for (const doc of children.docs) {
    const data = doc.data();
    people.set(doc.id, { id: doc.id, kind: 'child', displayName: str(data.displayName) ?? 'the child', avatarUrl: str(data.avatarUrl) });
  }
  for (const doc of characters.docs) {
    const data = doc.data();
    people.set(doc.id, { id: doc.id, kind: 'character', displayName: str(data.displayName) ?? 'a friend', avatarUrl: str(data.avatarUrl) });
  }
  return people;
}

/**
 * Stored text → words. Text from the engines carries `[[cast:id]]`; a title
 * the model proposed may still use another token form, which is resolved
 * within the owner's family first (an unknown id reads as "a friend").
 */
export function renderForReader(text: string | null | undefined, people: Map<string, Person>, heroId: string): string | null {
  if (text === null || text === undefined) return null;
  const resolve = (raw: string): string | null => {
    if (HERO_ALIASES.has(raw)) return heroId;
    if (people.has(raw)) return raw;
    const lower = raw.toLowerCase();
    for (const person of people.values()) if (person.displayName.toLowerCase() === lower) return person.id;
    return null;
  };
  const tokens = normalizeModelText(text, resolve);
  return renderCastTokens(tokens, (id) => people.get(id)?.displayName ?? null)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function iso(value: Timestamp | null | undefined): string | null {
  return value && typeof value.toDate === 'function' ? value.toDate().toISOString() : null;
}

export function toStoryView(story: WithId<Story>, people: Map<string, Person>): StoryView {
  const cast: StoryCastView[] = story.cast.map((member) => {
    const person = people.get(member.castId);
    return {
      castId: member.castId,
      kind: member.ref.kind,
      role: member.role,
      displayName: person?.displayName ?? (member.ref.kind === 'child' ? 'the child' : 'a friend'),
      avatarUrl: person?.avatarUrl ?? null,
    };
  });
  return {
    id: story.id,
    childId: story.childId,
    modeId: story.modeId,
    storyTypeId: story.storyTypeId,
    status: story.status,
    title: renderForReader(story.title, people, story.childId),
    synopsis: renderForReader(story.synopsis, people, story.childId),
    text: renderForReader(story.text, people, story.childId),
    cast,
    turnCount: story.turnCount,
    error: story.error,
    createdAt: iso(story.createdAt),
    updatedAt: iso(story.updatedAt),
    completedAt: iso(story.completedAt),
  };
}

export function toTurnView(turn: StoryTurn): StoryTurnReadView {
  return {
    index: turn.index,
    role: turn.role,
    kind: turn.kind,
    promptDisplay: turn.promptDisplay,
    options: turn.options?.map((o) => ({ id: o.id, display: o.display, preselected: o.preselected ?? false })) ?? null,
    expects: turn.expects,
    progress: turn.progress,
    inputDisplay: turn.inputDisplay,
    addedCast: turn.addedCast,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The child's Stories (the caller's child, persona scope applied), newest first. Abandoned ones are left out. */
export async function listStoriesForChild(db: Firestore, user: VerifiedUser, childId: string): Promise<StoryView[]> {
  if (!childId || childId.includes('/')) throw new BadRequestError('childId is required', { code: 'INVALID_QUERY' });
  const childSnap = await db.collection('children').doc(childId).get();
  const child = childSnap.data();
  if (!childSnap.exists || !child || (child.deletedAt !== undefined && child.deletedAt !== null) || typeof child.ownerParentUid !== 'string') {
    throw new NotFoundError('Child not found', { code: 'CHILD_NOT_FOUND', details: { childId } });
  }
  const ownerUid = child.ownerParentUid as string;
  await assertOwner(user, { ownerUid, childId }, 'Child');

  const snapshot = await db.collection('stories').where('ownerUid', '==', ownerUid).where('childId', '==', childId).get();
  const repo = stories.using(db);
  const found = snapshot.docs
    .filter((doc) => isTargetStory(doc.data()))
    .map((doc) => repo.parse(doc))
    .filter((story) => story.status !== 'abandoned')
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  if (found.length === 0) return [];
  const people = await loadPeople(db, ownerUid);
  return found.map((story) => toStoryView(story, people));
}

/** One of the caller's Stories (persona scope applied) and its turns, in order. */
export async function getStoryWithTurns(
  db: Firestore,
  user: VerifiedUser,
  storyId: string
): Promise<{ story: StoryView; turns: StoryTurnReadView[] }> {
  if (!storyId || storyId.includes('/')) throw new BadRequestError('Missing story id');
  const snapshot = await db.collection('stories').doc(storyId).get();
  if (!snapshot.exists || !isTargetStory(snapshot.data())) {
    throw new NotFoundError('Story not found', { code: 'STORY_NOT_FOUND', details: { id: storyId } });
  }
  const story = stories.using(db).parse(snapshot);
  await assertOwner(user, story, 'Story');
  const [people, turns] = await Promise.all([loadPeople(db, story.ownerUid), loadTurns(db, storyId)]);
  return { story: toStoryView(story, people), turns: turns.map(toTurnView) };
}

/**
 * The modes a child may choose from: live and enabled for kids, in display
 * order, with exactly one recommended (the configured one when it is offered,
 * else the wizard, else the first). The chooser is a child surface on every
 * client, so the same list goes to all of them.
 */
export async function listChoosableModes(db: Firestore): Promise<CreationModeView[]> {
  const modes = (await listCreationModes(db)).filter((mode: CreationMode) => mode.status === 'live' && mode.enabledForKids);
  const recommendedId =
    modes.find((m) => m.presentation.recommended)?.modeId ?? modes.find((m) => m.modeId === 'wizard')?.modeId ?? modes[0]?.modeId ?? null;
  return modes.map((mode) => ({
    modeId: mode.modeId,
    name: mode.presentation.name,
    description: mode.presentation.description,
    icon: mode.presentation.icon,
    gradient: mode.presentation.gradient,
    darkGradient: mode.presentation.darkGradient,
    loadingMessage: mode.presentation.loadingMessage,
    recommended: mode.modeId === recommendedId,
  }));
}
