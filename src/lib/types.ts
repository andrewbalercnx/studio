

'use client';

import type { Timestamp } from 'firebase/firestore';

export type Role = 'user' | 'assistant' | 'system';

export type UserProfile = {
  id: string;
  email: string;
  roles: {
    isAdmin: boolean;
    isWriter: boolean;
    isParent: boolean;
  };
  createdAt: any;
  pinHash?: string;
  pinSalt?: string;
  pinUpdatedAt?: any;
};

export type Choice = {
    id: string;
    text: string;
    value?: string;
    introducesCharacter?: boolean;
    newCharacterLabel?: string | null;
    newCharacterKind?: 'toy' | 'pet' | 'friend' | 'family' | 'other' | null;
    existingCharacterId?: string | null;
    avatarUrl?: string | null;
};

export type ChatMessage = {
    id: string;
    // This is different from the Genkit role, which is 'user' | 'assistant' | 'system'
    sender: 'child' | 'assistant' | 'system';
    text: string;
    createdAt: any; // Allow for server timestamp or Date
    // For Genkit compatibility
    role?: 'user' | 'model' | 'system' | 'tool';
    content?: string;
    // New structured fields
    kind?: 'beat_continuation' | 'beat_options' | 'child_choice' | 'character_traits_question' | 'character_traits_answer' | 'ending_options' | 'child_ending_choice' | 'system_status';
    options?: Choice[];
    selectedOptionId?: string;
};

export type StoryBeat = {
    label: string;
    childPlanText: string;
    draftText: string;
};

export type StorySession = {
    id:string;
    childId: string;
    parentUid: string;
    // The overall status of the story session.
    status: 'in_progress' | 'completed';
    // The current phase of the story creation process.
    currentPhase: 'warmup' | 'story' | 'ending' | 'final';
    currentStepIndex: number;
    storyTitle?: string;
    storyVibe?: string;
    finalStoryText?: string;
    createdAt: any; // Allow for server timestamp or Date
    updatedAt: any; // Allow for server timestamp or Date
    promptConfigId?: string;
    promptConfigLevelBand?: string;
    storyTypeId?: string;
    storyTypeName?: string;
    storyPhaseId?: string;
    endingPhaseId?: string;
    arcStepIndex?: number;
    // NEW FIELDS
    mainCharacterId?: string;
    supportingCharacterIds?: string[];
    pendingCharacterTraits?: {
      characterId: string;
      characterLabel: string;
      questionText: string;
      askedAt?: any;
    };
    selectedEndingId?: string;
    selectedEndingText?: string;
    progress?: {
      warmupCompletedAt?: any;
      storyTypeChosenAt?: any;
      storyArcCompletedAt?: any;
      endingGeneratedAt?: any;
      endingChosenAt?: any;
      compileCompletedAt?: any;
      pagesGeneratedAt?: any;
      artGeneratedAt?: any;
    };
    // This is a client-side representation and not stored in Firestore directly
    // with the session document. It's populated from the messages sub-collection.
    messages?: ChatMessage[];
};

export type StoryBookStatus = 'text_ready' | 'images_pending';

export type StoryBookFinalizationStatus =
  | 'draft'
  | 'ready_to_finalize'
  | 'finalized'
  | 'printable_pending'
  | 'printable_ready'
  | 'ordered';

export type StoryBookFinalizedPage = {
  pageNumber: number;
  kind: StoryBookPage['kind'];
  title?: string;
  bodyText?: string;
  imageUrl?: string;
  imagePrompt?: string;
  layoutHints?: StoryBookPage['layoutHints'];
};

export type PrintableAssetMetadata = {
  dpi: number;
  trimSize: string;
  pageCount: number;
  spreadCount: number;
};

export type StoryBookFinalization = {
  version: number;
  status: StoryBookFinalizationStatus;
  lockedAt?: any;
  lockedBy?: string;
  lockedByEmail?: string | null;
  lockedByDisplayName?: string | null;
  printablePdfUrl?: string | null;
  printableGeneratedAt?: any;
  printableStoragePath?: string | null;
  printableMetadata?: PrintableAssetMetadata | null;
  printableStatus?: 'idle' | 'generating' | 'ready' | 'error';
  printableErrorMessage?: string | null;
  shareId?: string | null;
  shareLink?: string | null;
  shareExpiresAt?: any;
  shareRequiresPasscode?: boolean;
  sharePasscodeHint?: string | null;
  shareLastGeneratedAt?: any;
  lastOrderId?: string | null;
  regressionTag?: string | null;
};

export type StoryBookFinalizedMetadata = {
  bookTitle?: string;
  childName?: string;
  pageCount: number;
  capturedAt: any;
  version: number;
  storySessionId?: string;
  lockedByUid?: string;
  lockedByDisplayName?: string | null;
};

export type StoryBookShareTokenStatus = 'active' | 'revoked' | 'expired';

export type StoryBookShareToken = {
  id: string;
  bookId: string;
  status: StoryBookShareTokenStatus;
  expiresAt?: any;
  createdAt: any;
  createdBy: string;
  finalizationVersion: number;
  requiresPasscode: boolean;
  tokenHash?: string | null;
  tokenSalt?: string | null;
  passcodeHint?: string | null;
  revokedAt?: any;
  revokedBy?: string | null;
  regressionTag?: string | null;
};

export type StoryBook = {
  id?: string;
  storySessionId: string;
  childId: string;
  parentUid: string;
  storyText: string;
  metadata?: {
    paragraphs?: number;
    estimatedPages?: number;
    artStyleHint?: string;
    [key: string]: unknown;
  };
  status?: StoryBookStatus;
  pageGeneration?: StoryBookPageGenerationStatus;
  imageGeneration?: StoryBookImageGenerationStatus;
  storybookFinalization?: StoryBookFinalization | null;
  finalizedPages?: StoryBookFinalizedPage[] | null;
  finalizedMetadata?: StoryBookFinalizedMetadata | null;
  finalizedSnapshotAt?: any;
  isLocked?: boolean;
  createdAt: any;
  updatedAt: any;
};

export type StoryBookPageGenerationStatus = {
    status: 'idle' | 'running' | 'ready' | 'error';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
    pagesCount?: number;
};

export type StoryBookImageGenerationStatus = {
    status: 'idle' | 'running' | 'ready' | 'error';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
    pagesReady?: number;
    pagesTotal?: number;
};

export type StoryBookPage = {
    id?: string;
    pageNumber: number;
    kind: 'cover_front' | 'cover_back' | 'text' | 'image';
    title?: string;
    bodyText?: string;
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
        generatedAt?: any;
        lastErrorMessage?: string | null;
        regressionTag?: string | null;
    };
    layoutHints?: {
        aspectRatio?: 'square' | 'portrait' | 'landscape';
        textPlacement?: 'top' | 'bottom';
    };
    regressionTag?: string;
    regressionTest?: boolean;
    createdAt: any;
    updatedAt: any;
};

export type PrintOrderAddress = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type PrintOrder = {
  id?: string;
  parentUid: string;
  bookId: string;
  version: number;
  quantity: number;
  shippingAddress: PrintOrderAddress;
  contactEmail: string;
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  fulfillmentStatus: 'pending' | 'printing' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: any;
  updatedAt: any;
  paymentMarkedAt?: any;
  paymentMarkedBy?: string | null;
  fulfillmentUpdatedAt?: any;
  fulfillmentNotes?: string | null;
  printablePdfUrl?: string | null;
  regressionTag?: string | null;
};

export type ArtStyle = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

export type PromptConfig = {
    id: string;
    phase: string;
    levelBand: string;
    languageCode: string;
    version: number;
    status: string;
    systemPrompt: string;
    modeInstructions: string;
    additionalContextTemplate?: object;
    allowedChatMoves?: string[];
    model?: {
        name: string;
        temperature?: number;
        maxOutputTokens?: number;
    }
};

export type ChildPreferences = {
    favoriteColors?: string[];
    favoriteFoods?: string[];
    favoriteGames?: string[];
    favoriteSubjects?: string[];
};

export type ChildProfile = {
    id: string;
	displayName: string;
    ownerParentUid: string;
    dateOfBirth?: any;
    photos?: string[];
    avatarUrl?: string;
	createdAt: any;
    updatedAt?: any;
	estimatedLevel?: number;
	favouriteGenres?: string[];
	favouriteCharacterTypes?: string[];
	preferredStoryLength?: 'short' | 'medium' | 'long';
	helpPreference?: 'more_scaffolding' | 'balanced' | 'independent';
    preferences?: ChildPreferences;
};

export type StoryPhase = {
  id: string;
  name: string;
  phaseType: "warmup" | "storyBeat" | "ending";
  description: string;
  choiceCount: number;
  allowMore: boolean;
  status: "live" | "draft";
  orderIndex: number;
};

export type StoryType = {
  id: string;
  name: string;
  shortDescription: string;
  ageRange: string;
  status: "live" | "draft";
  tags: string[];
  defaultPhaseId: string;
  endingPhaseId: string;
  levelBands: string[];
  arcTemplate: {
    steps: string[];
  };
};

export type Character = {
    id: string;
    ownerChildId: string;
    sessionId?: string;
    role: 'child' | 'family' | 'friend' | 'pet' | 'other';
    name: string;
    realPersonRef?: {
        kind: 'self' | 'family' | 'friend';
        label: string;
    };
    traits?: string[];
    traitsLastUpdatedAt?: Date;
    visualNotes?: {
        hair?: string;
        clothing?: string;
        specialItem?: string;
        styleHint?: string;
    };
    createdAt: Timestamp;
    updatedAt: Timestamp;
    // New optional fields for tracking source
    introducedFromOptionId?: string;
    introducedFromMessageId?: string;
};

export type StoryOutputType = {
    id: string;
    name: string;
    status: "live" | "draft" | "archived";
    ageRange: string;
    shortDescription: string;
    childFacingLabel: string;
    category: "picture_book" | "poem" | "coloring_pages" | "audio_script";
    layoutHints?: {
        pageCount?: number;
        needsImages?: boolean;
        preferredAspectRatio?: "landscape" | "portrait" | "square";
        textDensity?: "very_low" | "low" | "medium";
    };
    aiHints?: {
        style?: string;
        allowRhyme?: boolean;
        maxPages?: number;
    };
    tags: string[];
    createdAt?: any;
    updatedAt?: any;
};

export type AppRoleMode = 'admin' | 'writer' | 'parent' | 'child' | 'unknown';
    
