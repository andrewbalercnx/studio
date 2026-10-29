/**
 * `StoryContext` (creation.md): built once per request by this module and
 * handed to the mode's engine. It holds the Story, its turns, the cast with
 * likeness summaries, the child's profile and preferences, the family roster
 * the AI may draw on, the mode config and (adventure) the StoryType.
 *
 * Every lookup is owner-scoped: a child or character is in the roster only if
 * its `ownerParentUid` is the Story's owner, it is not soft-deleted, and (for
 * characters) it is family-wide or scoped to this child. There is no lookup
 * by display name across families (as-is characters-actors.md bug 3).
 *
 * Likeness summary = `imageDescription`, which is generated from the original
 * photos only (CLAUDE.md rule); this module never derives it from anything else.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { isPlaceholderChild } from '@/lib/placeholder-child';
import type { ConfigService } from '../config/config-service';
import { globalPromptConfig } from '../config/definitions';
import { storyTurns } from '../data/repositories';
import type { WithId } from '../data/repository';
import type { CastMember, CreationModeId, StoryStatus, StoryTurn } from '../data/schemas/story';
import { NotFoundError } from '../errors';
import type { CreationMode } from './modes';
import { loadStoryType, type StoryTypeConfig } from './story-types';
import { HERO_ALIASES, castToken, normalizeModelText, renderCastTokens } from './tokens';

export type CastPerson = {
  /** = the document id (castId equals ref.id for every cast member). */
  castId: string;
  ref: { kind: 'child' | 'character'; id: string };
  displayName: string;
  pronouns: string | null;
  description: string | null;
  likes: string[];
  dislikes: string[];
  /** Characters: Family, Friend, Pet, Toy, Other. */
  characterType: string | null;
  /** Family characters: e.g. Grandma. */
  relationship: string | null;
  age: number | null;
  /** ISO date or null. */
  dateOfBirth: string | null;
  /** Appearance from the original photos (`imageDescription`); never shown to the child. */
  appearance: string | null;
  isHero: boolean;
  /** Character scoped to one child (null = family-wide). */
  scopedChildId: string | null;
  origin: 'parent' | 'story';
  /** Selection priority (today's selectCharactersSimple). */
  usageCount: number;
  lastUsedMs: number;
};

export type StoryContextInput = {
  storyId: string;
  ownerUid: string;
  childId: string;
  modeId: CreationModeId;
  status: StoryStatus;
  storyTypeId: string | null;
  cast: CastMember[];
  modeState: Record<string, unknown>;
  turnCount: number;
};

export type StoryContext = {
  storyId: string;
  ownerUid: string;
  childId: string;
  modeId: CreationModeId;
  status: StoryStatus;
  /** The Story's cast as stored; engines add to it only through `addCast`. */
  castMembers: CastMember[];
  /** Earlier turns, in order. */
  turns: WithId<StoryTurn>[];
  /** Index the next recorded turn gets. */
  nextTurnIndex: number;
  hero: CastPerson;
  /** People in the cast (hero first). Engine helpers append the people they add. */
  cast: CastPerson[];
  /** Everyone in the family the story may use (hero, siblings, characters in scope), including the cast. */
  roster: CastPerson[];
  childAge: number | null;
  /** The child's profile and preferences as prompt text (today's summarizeChildPreferences). */
  preferenceSummary: string;
  mode: CreationMode;
  storyType: StoryTypeConfig | null;
  /** `systemConfig/prompts` global prefix when enabled, else ''. */
  globalPrefix: string;
  /** Engine state; engines mutate it and the service stores it with the turn. */
  modeState: Record<string, unknown>;
  now: Date;
};

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const maybe = value as { toDate?: () => Date };
  const date = typeof maybe.toDate === 'function' ? maybe.toDate() : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ageInYears(dateOfBirth: unknown, now: Date): number | null {
  const dob = toDate(dateOfBirth);
  if (!dob) return null;
  const diff = now.getTime() - dob.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function millis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

function personFrom(kind: 'child' | 'character', id: string, data: Raw, heroId: string, now: Date): CastPerson {
  const dob = toDate(data.dateOfBirth);
  return {
    castId: id,
    ref: { kind, id },
    displayName: str(data.displayName) ?? (kind === 'child' ? 'the child' : 'a friend'),
    pronouns: str(data.pronouns),
    description: str(data.description),
    likes: strings(data.likes),
    dislikes: strings(data.dislikes),
    characterType: kind === 'character' ? str(data.type) : null,
    relationship: kind === 'character' ? str(data.relationship) : null,
    age: ageInYears(data.dateOfBirth, now),
    dateOfBirth: dob ? dob.toISOString().split('T')[0] : null,
    appearance: str(data.imageDescription),
    isHero: kind === 'child' && id === heroId,
    scopedChildId: kind === 'character' ? str(data.childId) : null,
    origin: data.origin === 'story' || data.isParentGenerated === false ? 'story' : 'parent',
    usageCount: typeof data.usageCount === 'number' ? data.usageCount : 0,
    lastUsedMs: millis(data.lastUsedAt),
  };
}

function notDeleted(data: Raw | undefined): data is Raw {
  return !!data && (data.deletedAt === undefined || data.deletedAt === null);
}

export type FamilyRoster = { hero: CastPerson; childAge: number | null; heroData: Raw; people: CastPerson[] };

/**
 * The owner's family, scoped to one child: the hero, siblings (not
 * placeholders) and characters that are family-wide or scoped to this child.
 * Throws NotFound when the hero is not the owner's child.
 */
export async function loadFamilyRoster(db: Firestore, ownerUid: string, childId: string, now: Date): Promise<FamilyRoster> {
  const heroSnap = await db.collection('children').doc(childId).get();
  const heroData = heroSnap.data();
  if (!heroSnap.exists || !notDeleted(heroData) || heroData.ownerParentUid !== ownerUid) {
    throw new NotFoundError('Child not found', { code: 'CHILD_NOT_FOUND', details: { childId } });
  }
  const [siblings, characters] = await Promise.all([
    db.collection('children').where('ownerParentUid', '==', ownerUid).get(),
    db.collection('characters').where('ownerParentUid', '==', ownerUid).get(),
  ]);
  const hero = personFrom('child', childId, heroData, childId, now);
  const people: CastPerson[] = [hero];
  for (const doc of siblings.docs) {
    const data = doc.data();
    if (doc.id === childId || !notDeleted(data) || isPlaceholderChild(data as { displayName?: string })) continue;
    people.push(personFrom('child', doc.id, data, childId, now));
  }
  for (const doc of characters.docs) {
    const data = doc.data();
    if (!notDeleted(data)) continue;
    const scope = str(data.childId);
    if (scope && scope !== childId) continue;
    people.push(personFrom('character', doc.id, data, childId, now));
  }
  return { hero, childAge: hero.age, heroData, people };
}

/** Today's summarizeChildPreferences, from the hero's profile. */
export function summarizePreferences(hero: CastPerson, heroData: Raw): string {
  const parts: string[] = [];
  if (hero.age !== null) parts.push(`Age: ${hero.age} years old`);
  parts.push(hero.pronouns ? `Pronouns: ${hero.pronouns}` : 'Pronouns: they/them (default)');
  if (hero.likes.length) parts.push(`Likes: ${hero.likes.join(', ')}`);
  if (hero.dislikes.length) parts.push(`Dislikes: ${hero.dislikes.join(', ')}`);
  if (hero.description) parts.push(`Description: ${hero.description}`);
  const photos = strings(heroData.photos).length;
  if (photos) parts.push(`Reference photos provided: ${photos}. Use them only for inspiration; never mention the photos directly.`);
  return parts.length > 0 ? parts.join('\n') : 'No preferences provided.';
}

export type BuildContextDeps = {
  config: Pick<ConfigService, 'get'>;
  now: () => Date;
};

/** Build the StoryContext for a stored Story or for one about to be created. */
export async function buildStoryContext(
  db: Firestore,
  input: StoryContextInput,
  mode: CreationMode,
  deps: BuildContextDeps,
  options: { turns?: WithId<StoryTurn>[] } = {}
): Promise<StoryContext> {
  const now = deps.now();
  const [family, turns, storyType, prefix] = await Promise.all([
    loadFamilyRoster(db, input.ownerUid, input.childId, now),
    options.turns ?? loadTurns(db, input.storyId),
    input.storyTypeId ? loadStoryType(db, input.storyTypeId) : Promise.resolve(null),
    deps.config.get(globalPromptConfig),
  ]);
  const byId = new Map(family.people.map((p) => [p.castId, p]));
  const cast: CastPerson[] = [family.hero];
  for (const member of input.cast) {
    const person = byId.get(member.castId);
    // A cast member deleted since (or never the owner's) is not offered to the model.
    if (person && !person.isHero) cast.push(person);
  }
  return {
    storyId: input.storyId,
    ownerUid: input.ownerUid,
    childId: input.childId,
    modeId: input.modeId,
    status: input.status,
    castMembers: input.cast,
    turns,
    nextTurnIndex: input.turnCount,
    hero: family.hero,
    cast,
    roster: family.people,
    childAge: family.childAge,
    preferenceSummary: summarizePreferences(family.hero, family.heroData),
    mode,
    storyType,
    globalPrefix: prefix.enabled && prefix.globalPrefix ? prefix.globalPrefix : '',
    modeState: structuredClone(input.modeState ?? {}),
    now,
  };
}

export async function loadTurns(db: Firestore, storyId: string): Promise<WithId<StoryTurn>[]> {
  const turns = await storyTurns.using(db).of(storyId).where({});
  return turns.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Tokens against this context
// ---------------------------------------------------------------------------

/** Resolve a raw model token (id, alias or display name) to a roster castId. */
export function tokenResolver(ctx: Pick<StoryContext, 'roster' | 'hero'>): (raw: string) => string | null {
  return (raw) => {
    if (HERO_ALIASES.has(raw)) return ctx.hero.castId;
    const byId = ctx.roster.find((p) => p.castId === raw);
    if (byId) return byId.castId;
    const lower = raw.toLowerCase();
    const byName = ctx.roster.find((p) => p.displayName.toLowerCase() === lower);
    return byName ? byName.castId : null;
  };
}

/** Model output → stored text with `[[cast:id]]` tokens (owner-scoped). */
export function normalizeText(ctx: Pick<StoryContext, 'roster' | 'hero'>, text: string | null | undefined): string {
  return normalizeModelText(text, tokenResolver(ctx)).trim();
}

/** Stored text → what the child reads. */
export function displayText(ctx: Pick<StoryContext, 'roster'>, text: string | null | undefined): string {
  return renderCastTokens(text, (id) => ctx.roster.find((p) => p.castId === id)?.displayName ?? null)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Prompt context (port of src/lib/story-context-builder.ts formatting)
// ---------------------------------------------------------------------------

function ageText(age: number | null): string {
  if (age === null) return 'Age unknown';
  if (age === 0) return 'Under 1 year old';
  return `${age} years old`;
}

function typeLabel(person: CastPerson): string {
  if (person.characterType === 'Family' && person.relationship) return person.relationship;
  return person.characterType ?? 'Other';
}

function profileLines(person: CastPerson): string {
  const pronouns = person.pronouns ? `\n  Pronouns: ${person.pronouns}` : '\n  Pronouns: they/them (default)';
  const description = person.description ? `\n  Description: ${person.description}` : '';
  const likes = person.likes.length ? `\n  Likes: ${person.likes.join(', ')}` : '';
  const dislikes = person.dislikes.length ? `\n  Dislikes: ${person.dislikes.join(', ')}` : '';
  return `  Age: ${ageText(person.age)} (Born: ${person.dateOfBirth ?? 'Unknown'})${pronouns}${description}${likes}${dislikes}`;
}

function formatChild(person: CastPerson, isMain: boolean): string {
  const label = isMain ? '**MAIN CHILD**' : 'Sibling';
  return `- ${label}: ${castToken(person.castId)} (display name: "${person.displayName}")\n${profileLines(person)}`;
}

function formatCharacter(person: CastPerson): string {
  const scope = person.scopedChildId ? ' [Child-specific]' : ' [Family-wide]';
  return `- Supporting Character: ${castToken(person.castId)} (display name: "${person.displayName}", type: ${typeLabel(person)})${scope}\n${profileLines(person)}`;
}

/** Characters offered to the model: the cast, then the best six others (parent-made first, most used, most recent). */
export function promptCharacters(ctx: Pick<StoryContext, 'roster' | 'cast'>, max = 6): CastPerson[] {
  const inCast = new Set(ctx.cast.map((p) => p.castId));
  const others = ctx.roster
    .filter((p) => p.ref.kind === 'character' && !inCast.has(p.castId))
    .sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === 'parent' ? -1 : 1;
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      return b.lastUsedMs - a.lastUsedMs;
    })
    .slice(0, max);
  return [...ctx.cast.filter((p) => p.ref.kind === 'character'), ...others];
}

export type FormattedContext = {
  fullContext: string;
  /** Characters the AI (or the child) added to this Story: they should keep playing a part. */
  newlyIntroducedContext: string;
};

export function formatStoryContext(ctx: Pick<StoryContext, 'roster' | 'cast' | 'hero' | 'castMembers'>): FormattedContext {
  const siblings = ctx.roster.filter((p) => p.ref.kind === 'child' && !p.isHero).slice(0, 9);
  const characters = promptCharacters(ctx);
  const siblingsContext = siblings.length ? siblings.map((s) => formatChild(s, false)).join('\n') : '- No siblings';
  const charactersContext = characters.length ? characters.map(formatCharacter).join('\n') : '- No supporting characters created yet';
  const added = new Set(ctx.castMembers.filter((m) => m.addedBy !== 'setup').map((m) => m.castId));
  const introduced = ctx.cast.filter((p) => added.has(p.castId) && p.ref.kind === 'character');
  return {
    fullContext: `**CHILD PROFILE (Main Subject of Story):**\n${formatChild(ctx.hero, true)}\n\n**SIBLINGS:**\n${siblingsContext}\n\n**SUPPORTING CHARACTERS:**\n${charactersContext}`,
    newlyIntroducedContext: introduced
      .map((p) => {
        const description = p.description ? ` - ${p.description}` : '';
        const likes = p.likes.length ? ` Likes: ${p.likes.join(', ')}.` : '';
        return `- ${castToken(p.castId)} (${p.displayName}): ${typeLabel(p)}, uses ${p.pronouns ?? 'they/them'} pronouns${description}.${likes}`;
      })
      .join('\n'),
  };
}

/** One person as a line for prompts that list a chosen cast (friends). */
export function describePerson(person: CastPerson): string {
  const parts: string[] = [];
  if (person.isHero) parts.push(`${castToken(person.castId)} (${person.displayName}) - the main child character`);
  else if (person.ref.kind === 'child') parts.push(`${castToken(person.castId)} (${person.displayName}) - a sibling`);
  else parts.push(`${castToken(person.castId)} (${person.displayName}) - ${person.characterType ?? 'Other'}`);
  if (person.pronouns) parts.push(`Uses ${person.pronouns} pronouns`);
  if (person.description) parts.push(person.description);
  if (person.likes.length) parts.push(`Likes: ${person.likes.join(', ')}`);
  if (person.dislikes.length) parts.push(`Dislikes: ${person.dislikes.join(', ')}`);
  return `${parts.join('. ')}.`;
}

/** Today's formatAgeDescription. */
export function ageDescription(age: number | null): string {
  if (age === null) return "The child's age is unknown.";
  if (age === 0) return 'The child is under 1 year old (a baby).';
  return `The child is ${age} years old.`;
}
