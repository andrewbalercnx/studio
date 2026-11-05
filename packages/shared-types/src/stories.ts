// ============================================================================
// Story creation (slice 5.4): POST /api/stories, /turns, /abandon, /finish
// and the read routes GET /api/stories, GET /api/stories/{id},
// GET /api/creation-modes. Routes answer { ok: true, data } or
// { ok: false, error: { code, message } }.
// ============================================================================

export type CreationModeId = 'wizard' | 'freeplay' | 'guided' | 'friends' | 'adventure';
export type StoryStatus = 'creating' | 'finishing' | 'complete' | 'abandoned' | 'failed';
export type TurnExpects = 'choice' | 'text' | 'castPick';

/** A way to make a story, presented kid-safely (GET /api/creation-modes). */
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

export type StoryCastView = {
  castId: string;
  kind: 'child' | 'character';
  role: 'hero' | 'supporting';
  displayName: string;
  avatarUrl: string | null;
};

/** A Story with every text rendered with names (server-side). */
export type StoryView = {
  id: string;
  childId: string;
  modeId: CreationModeId;
  storyTypeId: string | null;
  status: StoryStatus;
  title: string | null;
  synopsis: string | null;
  /** The finished text; null while the Story is being created. */
  text: string | null;
  cast: StoryCastView[];
  turnCount: number;
  error: { code: string; message: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

export type TurnOptionView = { id: string; display: string; preselected?: boolean };

/** One turn of a Story (GET /api/stories/{id}). */
export type StoryTurnView = {
  index: number;
  role: 'ai' | 'child';
  kind: 'prompt' | 'input' | 'done';
  promptDisplay: string | null;
  options: TurnOptionView[] | null;
  expects: TurnExpects | null;
  progress: { step: number; of: number | null } | null;
  inputDisplay: string | null;
  addedCast: string[];
};

/** What the child sends. */
export type ChildInput =
  | { kind: 'choice'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'castPick'; castIds: string[] };

export type CreateStoryRequest = {
  childId: string;
  modeId: CreationModeId;
  castIds?: string[];
  /** adventure only: skip the story-type question. */
  storyTypeId?: string;
  /** One per tap; a repeat returns the same Story and first turn. */
  idempotencyKey: string;
};

export type SendTurnRequest = {
  input: ChildInput;
  /** One per answer; a repeat returns the recorded reply. */
  idempotencyKey: string;
};

/** POST /api/stories and POST /api/stories/{id}/turns. */
export type StoryTurnResult = {
  storyId: string;
  status: StoryStatus;
  turn: Omit<StoryTurnView, 'role' | 'inputDisplay'>;
  /** False when this repeated an earlier request (same idempotency key). */
  created: boolean;
};
