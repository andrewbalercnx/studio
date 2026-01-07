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
// Story Session Types
// ============================================================================

/** Choice option in story flow */
export type Choice = {
  id: string;
  text: string;
  value?: string;
  introducesCharacter?: boolean;
  newCharacterName?: string | null;
  newCharacterLabel?: string | null;
  newCharacterKind?: 'toy' | 'pet' | 'friend' | 'family' | null;
  newCharacterType?: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other' | null;
  existingCharacterId?: string | null;
  avatarUrl?: string | null;
};

/** Chat message in story session */
export type ChatMessage = {
  id: string;
  sender: 'child' | 'assistant' | 'system';
  text: string;
  createdAt: unknown; // Timestamp
  role?: 'user' | 'model' | 'system' | 'tool';
  content?: string;
  kind?:
    | 'beat_continuation'
    | 'beat_options'
    | 'child_choice'
    | 'character_traits_question'
    | 'character_traits_answer'
    | 'ending_options'
    | 'child_ending_choice'
    | 'system_status'
    | 'gemini3_question'
    | 'gemini3_choice'
    | 'gemini3_final_story'
    | 'gemini4_question'
    | 'gemini4_choice'
    | 'gemini4_final_story';
  options?: Choice[];
  selectedOptionId?: string;
};

/** Wizard mode Q&A answer */
export type StoryWizardAnswer = {
  question: string;
  answer: string;
};

/** Friends flow phase */
export type FriendsPhase =
  | 'character_selection'
  | 'scenario_selection'
  | 'synopsis_selection'
  | 'story_generation'
  | 'complete';

/** Friends scenario option */
export type FriendsScenario = {
  id: string;
  title: string;
  description: string;
};

/** Friends synopsis option */
export type FriendsSynopsis = {
  id: string;
  title: string;
  summary: string;
};

/**
 * Story session - tracks the interactive story creation process.
 * Stored at: storySessions/{sessionId}
 */
export type StorySession = {
  id: string;
  childId: string;
  parentUid: string;
  status: 'in_progress' | 'completed';
  currentPhase:
    | 'warmup'
    | 'story'
    | 'ending'
    | 'final'
    | 'wizard'
    | 'gemini3'
    | 'gemini4'
    | 'friends'
    | 'completed';
  currentStepIndex: number;
  storyTitle?: string;
  storyVibe?: string;
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
  storyTypeId?: string;
  arcStepIndex?: number;
  mainCharacterId?: string;
  supportingCharacterIds?: string[];
  storyMode?: string;
  wizardAnswers?: StoryWizardAnswer[];
  actors?: string[];
  friendsPhase?: FriendsPhase;
  friendsProposedCharacterIds?: string[];
  friendsSelectedCharacterIds?: string[];
  friendsScenarios?: FriendsScenario[];
  friendsSelectedScenarioId?: string;
  friendsSynopses?: FriendsSynopsis[];
  friendsSelectedSynopsisId?: string;
  friendsLastQuestion?: string;
  messages?: ChatMessage[];
  progress?: {
    warmupCompletedAt?: unknown;
    storyTypeChosenAt?: unknown;
    storyArcCompletedAt?: unknown;
    endingGeneratedAt?: unknown;
    endingChosenAt?: unknown;
    compileCompletedAt?: unknown;
  };
};

// ============================================================================
// Story Types
// ============================================================================

/** Generation status for async operations */
export type GenerationStatus = {
  status: 'idle' | 'running' | 'ready' | 'error' | 'rate_limited';
  lastRunAt?: unknown;
  lastCompletedAt?: unknown;
  lastErrorMessage?: string | null;
  rateLimitRetryAt?: unknown;
  rateLimitRetryCount?: number;
};

/** Page generation status */
export type StoryBookPageGenerationStatus = GenerationStatus & {
  pagesCount?: number;
  diagnostics?: Record<string, unknown> | null;
};

/** Image generation status */
export type StoryBookImageGenerationStatus = GenerationStatus & {
  pagesReady?: number;
  pagesTotal?: number;
};

/**
 * Story - the compiled narrative content.
 * Stored at: stories/{storyId}
 */
export type Story = {
  id?: string;
  storySessionId: string;
  childId: string;
  parentUid: string;
  storyText: string;
  storyMode?: string;
  metadata?: {
    title?: string;
    vibe?: string;
    paragraphs?: number;
    estimatedPages?: number;
    characterIds?: string[];
    [key: string]: unknown;
  };
  synopsis?: string | null;
  synopsisGeneration?: GenerationStatus;
  actors?: string[];
  actorAvatarUrl?: string | null;
  actorAvatarGeneration?: GenerationStatus;
  titleGeneration?: GenerationStatus;
  audioGeneration?: GenerationStatus;
  audioUrl?: string | null;
  audioMetadata?: {
    storagePath?: string;
    downloadToken?: string;
    durationSeconds?: number;
    voiceId?: string;
    generatedAt?: unknown;
    sizeBytes?: number;
  };
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
  deletedAt?: unknown;
};

// ============================================================================
// Storybook Types
// ============================================================================

/**
 * StoryBookOutput - a specific rendering of a Story (e.g., picture book, poem).
 * Stored at: stories/{storyId}/storybooks/{storybookId}
 */
export type StoryBookOutput = {
  id: string;
  storyId: string;
  childId: string;
  parentUid: string;
  storyOutputTypeId: string;
  imageStyleId: string;
  imageStylePrompt: string;
  printLayoutId?: string | null;
  imageWidthPx?: number;
  imageHeightPx?: number;
  pageGeneration: StoryBookPageGenerationStatus;
  imageGeneration: StoryBookImageGenerationStatus;
  isFinalized?: boolean;
  isLocked?: boolean;
  title?: string;
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
  deletedAt?: unknown;
};

/**
 * Page in a storybook.
 * Stored at: stories/{storyId}/storybooks/{storybookId}/pages/{pageId}
 */
export type StoryOutputPage = {
  id?: string;
  pageNumber: number;
  kind: 'cover_front' | 'cover_back' | 'title_page' | 'text' | 'image' | 'blank';
  title?: string;
  bodyText?: string;
  displayText?: string;
  entityIds?: string[];
  imageDescription?: string;
  imagePrompt?: string;
  imageUrl?: string;
  imageStatus?: 'pending' | 'generating' | 'ready' | 'error';
  imageMetadata?: {
    model?: string | null;
    width?: number | null;
    height?: number | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    storagePath?: string | null;
    downloadToken?: string | null;
    aspectRatioHint?: 'square' | 'portrait' | 'landscape' | null;
    generatedAt?: unknown;
    lastErrorMessage?: string | null;
  };
  layoutHints?: {
    aspectRatio?: 'square' | 'portrait' | 'landscape';
    textPlacement?: 'top' | 'bottom';
  };
  audioUrl?: string | null;
  audioStatus?: 'pending' | 'generating' | 'ready' | 'error';
  audioMetadata?: {
    storagePath?: string | null;
    downloadToken?: string | null;
    durationSeconds?: number | null;
    voiceId?: string | null;
    sizeBytes?: number | null;
    generatedAt?: unknown;
    lastErrorMessage?: string | null;
  };
  createdAt: unknown; // Timestamp
  updatedAt: unknown; // Timestamp
};

// ============================================================================
// Story Generator Types
// ============================================================================

/** Generator capabilities */
export type StoryGeneratorCapabilities = {
  minChoices: number;
  maxChoices: number;
  supportsMoreOptions: boolean;
  supportsCharacterIntroduction: boolean;
  supportsFinalStory: boolean;
  requiresStoryType: boolean;
};

/** Generator styling for UI */
export type StoryGeneratorStyling = {
  gradient: string;
  darkGradient?: string;
  icon?: string;
  loadingMessage: string;
};

/** Background music for generator */
export type StoryGeneratorBackgroundMusic = {
  prompt?: string;
  audioUrl?: string | null;
  storagePath?: string;
  durationMs?: number;
};

/**
 * Story generator configuration.
 * Stored at: storyGenerators/{generatorId}
 */
export type StoryGenerator = {
  id: string;
  name: string;
  description: string;
  status: 'live' | 'draft' | 'archived';
  order?: number;
  capabilities: StoryGeneratorCapabilities;
  apiEndpoint: string;
  styling: StoryGeneratorStyling;
  enabledForKids?: boolean;
  backgroundMusic?: StoryGeneratorBackgroundMusic;
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
// API Response Types
// ============================================================================

/** Character option in friends flow */
export type FriendsCharacterOption = {
  id: string;
  displayName: string;
  type: 'child' | 'sibling' | 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  avatarUrl?: string;
  isSelected: boolean;
};

/** Option in story generator response */
export type StoryGeneratorResponseOption = {
  id: string;
  text: string;
  textResolved?: string;
  introducesCharacter?: boolean;
  newCharacterName?: string;
  newCharacterLabel?: string;
  newCharacterType?: string;
  existingCharacterId?: string;
  isMoreOption?: boolean;
};

/**
 * Standard response format for all story generator APIs.
 */
export type StoryGeneratorResponse = {
  ok: boolean;
  sessionId: string;
  headerText?: string;
  headerTextResolved?: string;
  question: string;
  questionResolved?: string;
  options: StoryGeneratorResponseOption[];
  isStoryComplete?: boolean;
  finalStory?: string;
  finalStoryResolved?: string;
  progress?: number;
  isEndingPhase?: boolean;
  friendsPhase?: FriendsPhase;
  proposedCharacters?: FriendsCharacterOption[];
  availableCharacters?: FriendsCharacterOption[];
  scenarios?: FriendsScenario[];
  synopses?: FriendsSynopsis[];
  debug?: Record<string, unknown>;
  errorMessage?: string;
};

/**
 * Response from story compile endpoint.
 */
export type StoryCompileResponse = {
  ok: boolean;
  storyId?: string;
  storyText?: string;
  rawStoryText?: string;
  synopsis?: string;
  metadata?: {
    paragraphs?: number;
    [key: string]: unknown;
  };
  actors?: string[];
  errorMessage?: string;
};

/**
 * Response from kids-generators endpoint.
 */
export type KidsGeneratorsResponse = {
  ok: boolean;
  generators: StoryGenerator[];
  errorMessage?: string;
};

/**
 * Response from storybook pages endpoint.
 */
export type StorybookPagesResponse = {
  ok: boolean;
  storyId?: string;
  storybookId?: string;
  pagesCount?: number;
  errorMessage?: string;
};

/**
 * Response from storybook images endpoint.
 */
export type StorybookImagesResponse = {
  ok: boolean;
  storyId?: string;
  storybookId?: string;
  pagesReady?: number;
  pagesTotal?: number;
  errorMessage?: string;
};

/**
 * Response from TTS endpoint.
 */
export type TTSResponse = {
  ok: boolean;
  audioUrl?: string;
  errorMessage?: string;
};

// ============================================================================
// API Request Types
// ============================================================================

/** Request body for wizard endpoint */
export type StoryWizardRequest = {
  sessionId: string;
  selectedOptionId?: string;
};

/** Request body for friends endpoint */
export type StoryFriendsRequest = {
  sessionId: string;
  selectedOptionId?: string;
  action?: 'confirm_characters' | 'change_characters' | 'more_synopses';
  selectedCharacterIds?: string[];
};

/** Request body for gemini3/gemini4 endpoints */
export type StoryGeminiRequest = {
  sessionId: string;
  selectedOptionId?: string;
  userMessage?: string;
};

/** Request body for story beat endpoint */
export type StoryBeatRequest = {
  sessionId: string;
  selectedOptionId?: string;
  moreOptions?: boolean;
};

/** Request body for story compile endpoint */
export type StoryCompileRequest = {
  sessionId: string;
};

/** Request body for storybook pages endpoint */
export type StorybookPagesRequest = {
  storyId: string;
  storybookId: string;
  storyOutputTypeId: string;
};

/** Request body for storybook images endpoint */
export type StorybookImagesRequest = {
  storyId: string;
  storybookId: string;
  imageStyleId: string;
};

/** Request body for TTS endpoint */
export type TTSRequest = {
  text: string;
  voiceId?: string;
  childId?: string;
};
