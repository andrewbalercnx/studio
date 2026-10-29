/**
 * The creation-mode interface (creation.md "The interface"). One engine per
 * mode under ./engines; the service (./service.ts) records what they return.
 *
 * Engines are pure with respect to storage: they read the StoryContext, may
 * mutate `ctx.modeState` (stored with the turn), and return a Turn or Done.
 * They never write Firestore and never trust state from the client.
 */
import type { AIHarness } from '../ai/harness';
import type { ConfigService } from '../config/config-service';
import type { ChildInput, CreationModeId } from '../data/schemas/story';
import type { StoryContext } from './context';

export type { ChildInput } from '../data/schemas/story';

export type CharacterKind = 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';

/** An AI-introduced character, created as a `characters` doc (`origin: 'story'`) with the turn. */
export type NewCharacter = {
  displayName: string;
  type: CharacterKind;
  /** The phrase the AI introduced them with ("a wise old owl…"). */
  label: string;
  pronouns: 'he/him' | 'she/her' | 'they/them';
  description: string;
  likes: string[];
  dislikes: string[];
  /** ISO date (from an estimated age) or null. */
  dateOfBirth: string | null;
};

/** Someone joining the cast with this turn. */
export type NewCastMember =
  | { kind: 'existing'; castId: string; ref: { kind: 'child' | 'character'; id: string }; addedBy: 'child' | 'ai' }
  | { kind: 'new'; castId: string; character: NewCharacter; addedBy: 'ai' };

export type EngineOption = { id: string; text: string; preselected?: boolean };

export type Turn = {
  kind?: 'turn';
  /** With `[[cast:id]]` tokens. */
  prompt: string;
  options?: EngineOption[];
  addCast?: NewCastMember[];
  progress?: { step: number; of?: number };
  /** UI hint: which input this prompt wants (the engine validates what arrives). Default `choice` with options, else `text`. */
  expects?: 'choice' | 'text' | 'castPick';
};

export type Done = { kind: 'done'; text: string; titleHint?: string; addCast?: NewCastMember[] };

export interface CreationModeEngine {
  readonly modeId: CreationModeId;
  /** Called once when the Story is created. Returns the first prompt for the child. */
  start(ctx: StoryContext): Promise<Turn>;
  /** Called for each child input. Returns the next prompt, or `done` with the final text. */
  respond(ctx: StoryContext, input: ChildInput): Promise<Turn | Done>;
}

export function isDone(result: Turn | Done): result is Done {
  return result.kind === 'done';
}

/** What engines depend on, injectable so tests and TEST_MODE run without a model. */
export type EngineDeps = {
  ai: Pick<AIHarness, 'generateText'>;
  /** TEST_MODE seam (src/lib/test-mode.ts): every model call returns its deterministic fixture. */
  testMode: () => boolean;
  config: Pick<ConfigService, 'get'>;
};
