/**
 * @storypic/shared-types
 *
 * Shared TypeScript types for StoryPic Kids API.
 * These types define the contract between the server and any client (PWA, mobile).
 *
 * NOTE: This package only includes types needed for child-facing functionality.
 * Admin, print ordering, and writer features are not included.
 */

// ============================================================================
// Common Types
// ============================================================================

/** Pronouns for children and characters - used in story generation */
export type Pronouns = 'he/him' | 'she/her' | 'they/them';

/** Role in chat messages (Genkit compatible) */
export type Role = 'user' | 'assistant' | 'system';

// ============================================================================
// Child Profile Types
// ============================================================================

/**
 * Child profile - the main actor in stories.
 * Stored at: children/{childId}
 */
export type ChildProfile = {
  id: string;
  displayName: string;
  pronouns?: Pronouns;
  dateOfBirth?: unknown; // Timestamp
  photos?: string[];
  avatarUrl?: string;
  avatarAnimationUrl?: string;
  likes: string[];
  dislikes: string[];
  description?: string;
  ownerParentUid: string;
  createdAt: unknown; // Timestamp
  updatedAt?: unknown; // Timestamp
  namePronunciation?: string;
  preferredVoiceId?: string;
  autoReadAloud?: boolean;
};

/**
 * Character - supporting actors in stories (pets, toys, family, friends).
 * Stored at: characters/{characterId}
 */
export type Character = {
  id: string;
  displayName: string;
  pronouns?: Pronouns;
  photos?: string[];
  avatarUrl?: string;
  avatarAnimationUrl?: string;
  type: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  relationship?: string;
  namePronunciation?: string;
  likes: string[];
  dislikes: string[];
  description?: string;
  ownerParentUid: string;
  childId?: string;
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
};

// ============================================================================
// Story Output Type and Image Style Types
// ============================================================================

/**
 * Story output type (e.g., picture book, poem).
 * Stored at: storyOutputTypes/{outputTypeId}
 */
export type StoryOutputType = {
  id: string;
  name: string;
  status: 'live' | 'draft' | 'archived';
  ageRange: string;
  shortDescription: string;
  childFacingLabel: string;
  category: 'picture_book' | 'poem' | 'coloring_pages' | 'audio_script';
  defaultPrintLayoutId?: string;
  imageUrl?: string;
  layoutHints?: {
    pageCount?: number;
    needsImages?: boolean;
    preferredAspectRatio?: 'landscape' | 'portrait' | 'square';
    textDensity?: 'very_low' | 'low' | 'medium';
  };
  tags: string[];
};

/**
 * Image style for storybook illustrations.
 * Stored at: imageStyles/{styleId}
 */
export type ImageStyle = {
  id: string;
  title: string;
  description: string;
  ageRange: string;
  ageFrom?: number | null;
  ageTo?: number | null;
  stylePrompt: string;
  sampleDescription: string;
  sampleImageUrl?: string | null;
  preferred?: boolean;
};

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

export type TurnOptionView = { id: string; display: string; preselected: boolean };

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

// ============================================================================
// TTS
// ============================================================================

/** Response from TTS endpoint. */
export type TTSResponse = {
  ok: boolean;
  audioUrl?: string;
  errorMessage?: string;
};

/** Request body for TTS endpoint */
export type TTSRequest = {
  text: string;
  voiceId?: string;
  childId?: string;
};
