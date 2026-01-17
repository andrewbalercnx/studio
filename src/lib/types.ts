
'use client';

import type { Timestamp } from 'firebase/firestore';

// Default print layout used when child has no preference set
export const DEFAULT_PRINT_LAYOUT_ID = 'a4-portrait-spread-v1';

// DPI used for print-quality image generation
export const PRINT_DPI = 300;

export type Role = 'user' | 'assistant' | 'system';

// Pronouns for children and characters - used in story generation
export type Pronouns = 'he/him' | 'she/her' | 'they/them';

// Helper to get pronoun forms for story text
export function getPronounForms(pronouns?: Pronouns | null): {
  subject: string;      // he/she/they
  object: string;       // him/her/them
  possessive: string;   // his/her/their
  reflexive: string;    // himself/herself/themself
  isPlural: boolean;    // for verb conjugation (they are vs he is)
} {
  switch (pronouns) {
    case 'he/him':
      return { subject: 'he', object: 'him', possessive: 'his', reflexive: 'himself', isPlural: false };
    case 'she/her':
      return { subject: 'she', object: 'her', possessive: 'her', reflexive: 'herself', isPlural: false };
    case 'they/them':
      return { subject: 'they', object: 'them', possessive: 'their', reflexive: 'themself', isPlural: true };
    default:
      // Default to they/them if not specified
      return { subject: 'they', object: 'them', possessive: 'their', reflexive: 'themself', isPlural: true };
  }
}

// Address type for print orders - defined early for use in UserProfile
export type PrintOrderAddress = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

// Saved address for parent address book and system addresses
export type SavedAddress = PrintOrderAddress & {
  id: string;
  label?: string;        // "Home", "Work", "Grandma's"
  isDefault?: boolean;
  createdAt: any;
  updatedAt: any;
};

// System address configuration
export type SystemAddressConfig = {
  addresses: SavedAddress[];
  mixamBillToAddressId: string | null;
  updatedAt?: any;
  updatedBy?: string;
};

export const DEFAULT_SYSTEM_ADDRESS_CONFIG: SystemAddressConfig = {
  addresses: [],
  mixamBillToAddressId: null,
};

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
  savedShippingAddress?: PrintOrderAddress;
  canShowWizardTargets?: boolean; // Allow this user to toggle wizard target overlays
  hasCompletedStartupWizard?: boolean; // True once user has seen the default startup wizard
  notifiedUser?: boolean; // Receives admin notifications for print orders
  maintenanceUser?: boolean; // Receives maintenance/error notification emails
};

// Parent's cloned voice for TTS (stored in Firestore: users/{parentUid}/voices/{voiceId})
export type ParentVoice = {
  id: string; // Firestore document ID (same as ElevenLabs voice_id)
  parentUid: string; // Owner's Firebase UID
  name: string; // Display name (e.g., "Mum", "Dad", "Grandma")
  elevenLabsVoiceId: string; // ElevenLabs voice ID returned from cloning
  sampleAudioUrl?: string; // URL to the original audio sample in Firebase Storage
  sampleStoragePath?: string; // Storage path for the sample
  createdAt: any;
  updatedAt?: any;
};

export type Choice = {
    id: string;
    text: string;
    value?: string;
    introducesCharacter?: boolean;
    newCharacterName?: string | null; // The character's proper name (e.g., "Nutsy", "Captain Sparkle")
    newCharacterLabel?: string | null; // Descriptive phrase (e.g., "a friendly squirrel who loves acorns")
    newCharacterKind?: 'toy' | 'pet' | 'friend' | 'family' | null;
    newCharacterType?: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other' | null; // Alternative to newCharacterKind
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
    kind?: 'beat_continuation' | 'beat_options' | 'child_choice' | 'character_traits_question' | 'character_traits_answer' | 'ending_options' | 'child_ending_choice' | 'system_status' | 'gemini3_question' | 'gemini3_choice' | 'gemini3_final_story' | 'gemini4_question' | 'gemini4_choice' | 'gemini4_final_story';
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
    currentPhase: 'warmup' | 'story' | 'ending' | 'final' | 'wizard' | 'gemini3' | 'gemini4' | 'friends' | 'completed';
    currentStepIndex: number;
    storyTitle?: string;
    storyVibe?: string;
    createdAt: any; // Allow for server timestamp or Date
    updatedAt: any; // Allow for server timestamp or Date
    promptConfigId?: string;
    promptConfigLevelBand?: string;
    storyTypeId?: string;
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
    storyOutputTypeId?: string;
    // Story generator ID - identifies which generator/flow created this story
    storyMode?: string;
    gemini3FinalStory?: string;
    gemini4FinalStory?: string;
    // Wizard mode: tracks Q&A answers across API calls
    wizardAnswers?: StoryWizardAnswer[];
    // List of actor IDs ($$id$$ placeholders) discovered during story play
    // This gets copied to Story.actors at compile time
    actors?: string[];
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

    // === Friends flow fields ===
    // Phase tracking for "Fun with my friends" generator
    friendsPhase?: FriendsPhase;
    // Characters proposed by AI for the adventure
    friendsProposedCharacterIds?: string[];
    // Characters selected/confirmed by the child (may differ from proposed)
    friendsSelectedCharacterIds?: string[];
    // Scenario options generated by AI
    friendsScenarios?: FriendsScenario[];
    // Selected scenario ID
    friendsSelectedScenarioId?: string;
    // Synopsis options generated by AI
    friendsSynopses?: FriendsSynopsis[];
    // Selected synopsis ID
    friendsSelectedSynopsisId?: string;
    // Last API response state for UI restoration
    friendsLastQuestion?: string;
    // AI's rationale for the character selection (passed to scenario/synopsis generation)
    friendsCharacterRationale?: string;
};

export type StoryStatus = 'text_ready' | 'images_pending';

export type StoryBookFinalizationStatus =
  | 'draft'
  | 'ready_to_finalize'
  | 'finalized'
  | 'printable_pending'
  | 'printable_ready'
  | 'ordered';

export type StoryBookFinalizedPage = {
  pageNumber: number;
  kind: StoryOutputPage['kind'];
  title?: string;
  bodyText?: string;
  imageUrl?: string;
  imagePrompt?: string;
  layoutHints?: StoryOutputPage['layoutHints'];
};

export type PrintableAssetMetadata = {
  dpi: number;
  trimSize: string;
  pageCount: number; // Total pages in the PrintStoryBook (cover + interior content)
  coverPageCount: number; // 2 for hardcover (front + back outside), 4 for paperback
  interiorPageCount: number; // Total pages in interior PDF (content + padding) - must match actual PDF
  spreadCount: number;
  printLayoutId?: string;
  // Mixam-specific: separate PDFs
  hasSeparatePDFs?: boolean;
  // Padding pages added to meet minimum requirements (for hardcover minimum 24 interior)
  paddingPageCount?: number;
  // Actual content pages before padding (for display purposes)
  contentPageCount?: number;
};

export type StoryBookFinalization = {
  version: number;
  status: StoryBookFinalizationStatus;
  lockedAt?: any;
  lockedBy?: string;
  lockedByEmail?: string | null;
  lockedByDisplayName?: string | null;
  printablePdfUrl?: string | null; // Legacy: combined PDF
  printableGeneratedAt?: any;
  printableStoragePath?: string | null;
  printableMetadata?: PrintableAssetMetadata | null;
  printableStatus?: 'idle' | 'generating' | 'ready' | 'error';
  printableErrorMessage?: string | null;
  // Mixam-specific: separate PDFs for cover and interior
  printableCoverPdfUrl?: string | null;
  printableInteriorPdfUrl?: string | null;
  printableCoverStoragePath?: string | null;
  printableInteriorStoragePath?: string | null;
  shareId?: string | null;
  shareLink?: string | null;
  shareExpiresAt?: any;
  shareRequiresPasscode?: boolean;
  sharePasscodeHint?: string | null;
  shareLastGeneratedAt?: any;
  lastOrderId?: string | null;
  regressionTag?: string | null;
  // Legacy: finalized metadata stored directly on finalization
  finalizedMetadata?: StoryBookFinalizedMetadata | null;
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

/**
 * Story - The narrative content created by the child.
 * A Story can have multiple StoryBookOutput instances (different formats/styles).
 * Stored at: stories/{storyId}
 */
export type Story = {
  id?: string;
  storySessionId: string;
  childId: string;
  parentUid: string;
  storyText: string;
  // Which AI flow/generator created this story (copied from session at compile time)
  storyMode?: string;
  metadata?: {
    title?: string;
    vibe?: string;
    paragraphs?: number;
    estimatedPages?: number;
    characterIds?: string[];  // Characters used in this story
    [key: string]: unknown;
  };
  status?: StoryStatus;
  createdAt: any;
  updatedAt: any;

  // AI-generated title (created in background after story compilation)
  titleGeneration?: {
    status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
  };

  // AI-generated synopsis with $$id$$ placeholders for actors
  synopsis?: string | null;
  synopsisGeneration?: {
    status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
  };

  // List of actor IDs ($$id$$) used in the story - includes child, characters, etc.
  actors?: string[];

  // Composite avatar created from all actors in the story
  actorAvatarUrl?: string | null;
  actorAvatarGeneration?: {
    status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
  };

  // Legacy fields for backward compatibility with wizard flow and old data model
  pageGeneration?: StoryBookPageGenerationStatus;
  imageGeneration?: StoryBookImageGenerationStatus;
  isLocked?: boolean;
  storybookFinalization?: StoryBookFinalization | null;
  selectedImageStyleId?: string;
  selectedImageStylePrompt?: string;

  // Audio narration
  audioGeneration?: {
    status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
  };
  audioUrl?: string | null;
  audioMetadata?: {
    storagePath?: string;
    downloadToken?: string;
    durationSeconds?: number;
    voiceId?: string;
    generatedAt?: any;
    sizeBytes?: number;
  };

  // Soft delete - set when parent "deletes" (hides) the story
  // Only admins can permanently delete or restore
  deletedAt?: any;
  deletedBy?: string; // UID of the user who deleted
};

/**
 * ActorExemplar - A character reference sheet showing front/side/back views
 * Generated in a specific image style for consistent character depiction across storybook pages.
 * Stored at: exemplars/{exemplarId}
 */
export type ActorExemplar = {
  id: string;                    // Document ID
  actorId: string;               // Child or character document ID
  actorType: 'child' | 'character';
  imageStyleId: string;          // The style this exemplar was generated for
  imageUrl?: string;             // Firebase Storage URL (set when ready)
  storagePath?: string;          // For cleanup
  status: 'pending' | 'generating' | 'ready' | 'error';
  lastErrorMessage?: string;
  createdAt: any;
  updatedAt: any;
  // For admin cleanup
  ownerParentUid: string;
  usedByStorybookIds?: string[]; // Track which storybooks used this exemplar
};

/**
 * Exemplar generation status for a storybook
 */
export type StoryBookExemplarGenerationStatus = {
  status: 'idle' | 'pending' | 'running' | 'ready' | 'error';
  lastRunAt?: any;
  lastCompletedAt?: any;
  lastErrorMessage?: string;
  actorsTotal?: number;
  actorsReady?: number;
};

/**
 * StoryBookOutput - A specific rendering of a Story with output type, image style, and layout.
 * Multiple StoryBookOutputs can be created from a single Story.
 * Stored at: stories/{storyId}/storybooks/{storybookId}
 * Pages stored at: stories/{storyId}/storybooks/{storybookId}/pages/{pageId}
 */
export type StoryBookOutput = {
  id: string;
  storyId: string;
  childId: string;
  parentUid: string;

  // Configuration - set before generation
  storyOutputTypeId: string;      // Picture Book, Poem, etc.
  imageStyleId: string;           // Watercolor, Cartoon, etc.
  imageStylePrompt: string;       // The actual style prompt for image generation
  printLayoutId?: string | null;  // Determines image dimensions (optional - if not set, uses unconstrained defaults)

  // Computed from PrintLayout for image generation
  imageWidthPx?: number;          // Width in pixels (layoutWidth * 300 DPI)
  imageHeightPx?: number;         // Height in pixels (layoutHeight * 300 DPI)

  // Generation status
  pageGeneration: StoryBookPageGenerationStatus;
  imageGeneration: StoryBookImageGenerationStatus;
  exemplarGeneration?: StoryBookExemplarGenerationStatus;

  // Map of actorId -> exemplarId for this storybook's character reference images
  // @deprecated Use actorExemplarUrls instead
  actorExemplars?: Record<string, string>;

  // Map of actorId -> exemplarImageUrl for this storybook's character reference images
  actorExemplarUrls?: Record<string, string>;

  // Finalization for print
  isFinalized?: boolean;
  isLocked?: boolean;
  finalization?: StoryBookFinalization | null;

  // Metadata
  title?: string;                 // Can override story title
  createdAt: any;
  updatedAt: any;

  // Soft delete - set when parent "deletes" (hides) the storybook
  // Only admins can permanently delete or restore
  deletedAt?: any;
  deletedBy?: string; // UID of the user who deleted
};

/**
 * @deprecated Use StoryBookOutput instead. This type exists for backward compatibility
 * with the old data model where Story contained output-specific fields.
 */
export type LegacyStoryWithOutput = {
  id?: string;
  storySessionId: string;
  childId: string;
  parentUid: string;
  storyText: string;
  metadata?: {
    title?: string;
    vibe?: string;
    paragraphs?: number;
    estimatedPages?: number;
    artStyleHint?: string;
    storyOutputTypeId?: string;
    storyOutputTypeName?: string;
    [key: string]: unknown;
  };
  status?: StoryStatus;
  selectedImageStyleId?: string;
  selectedImageStylePrompt?: string;
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

/**
 * @deprecated Use StoryBookOutput instead. Alias kept for backward compatibility.
 */
export type StoryBook = LegacyStoryWithOutput;

export type PrintStoryBookStatus = 'draft' | 'generating_pdfs' | 'ready' | 'error';

export type PrintStoryBookPage = {
  pageNumber: number;
  type: 'cover_front' | 'cover_back' | 'endpaper_front' | 'endpaper_back' | 'interior';
  displayText?: string;
  imageUrl?: string;
  printLayoutId: string;
  // Custom positioning if user adjusted from default layout
  customTextBox?: { x: number; y: number; width: number; height: number };
  customImageBox?: { x: number; y: number; width: number; height: number };
};

export type PrintStoryBook = {
  id: string;
  ownerUserId: string;
  storyId: string;
  storybookId?: string;  // If set, use new model path: stories/{storyId}/storybooks/{storybookId}/pages
  storySessionId?: string;
  title: string;
  childName?: string;
  printLayoutId: string;
  pages: PrintStoryBookPage[];
  pdfStatus: PrintStoryBookStatus;
  coverPdfUrl?: string;
  interiorPdfUrl?: string;
  combinedPdfUrl?: string;
  printableMetadata?: PrintableAssetMetadata;
  pdfErrorMessage?: string;
  // Warnings generated during PDF creation (page count adjustments, truncations)
  pdfGenerationWarnings?: string[];
  createdAt: any;
  updatedAt: any;
  generatedAt?: any;
};

export type StoryBookPageGenerationStatus = {
    status: 'idle' | 'running' | 'ready' | 'error' | 'rate_limited';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
    pagesCount?: number;
    diagnostics?: Record<string, unknown> | null;
    // Rate limit retry tracking
    rateLimitRetryAt?: any;        // When the next automatic retry will occur
    rateLimitRetryCount?: number;  // How many retries have been attempted
};

export type StoryBookImageGenerationStatus = {
    status: 'idle' | 'running' | 'ready' | 'error' | 'rate_limited';
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
    pagesReady?: number;
    pagesTotal?: number;
    // Rate limit retry tracking
    rateLimitRetryAt?: any;        // When the next automatic retry will occur
    rateLimitRetryCount?: number;  // How many retries have been attempted
};

export type StoryOutputPage = {
    id?: string;
    pageNumber: number;
    kind: 'cover_front' | 'cover_back' | 'title_page' | 'text' | 'image' | 'blank';
    title?: string;
    bodyText?: string;
    displayText?: string;
    entityIds?: string[];  // IDs of characters/children referenced on this page ($$id$$ placeholders)
    imageDescription?: string;  // AI-generated scene description for image generation (uses $$id$$ placeholders)
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
    // Page-level audio narration
    audioUrl?: string | null;
    audioStatus?: 'pending' | 'generating' | 'ready' | 'error';
    audioMetadata?: {
        storagePath?: string | null;
        downloadToken?: string | null;
        durationSeconds?: number | null;
        voiceId?: string | null;
        sizeBytes?: number | null;
        generatedAt?: any;
        lastErrorMessage?: string | null;
    };
    regressionTag?: string;
    regressionTest?: boolean;
    createdAt: any;
    updatedAt: any;
};

/**
 * @deprecated Use StoryOutputPage instead. Alias kept for backward compatibility.
 */
export type StoryBookPage = StoryOutputPage;

// StoryOutput represents a story with its output/finalization data
// Used by order pages and print workflows
export type StoryOutput = {
    id?: string;
    title?: string;
    metadata?: {
        title?: string;
    };
    finalization?: {
        status?: 'draft' | 'finalized' | 'printable_ready' | 'ordered';
        printableCoverPdfUrl?: string | null;
        printableInteriorPdfUrl?: string | null;
        printablePdfUrl?: string | null;
        printableMetadata?: {
            pageCount?: number;
            coverPageCount?: number;
            interiorPageCount?: number;
        };
        shareLink?: string | null;
        shareExpiresAt?: any;
        lockedAt?: any;
        lockedBy?: string;
    };
    storybookFinalization?: StoryOutput['finalization'];
};

// Mixam-specific types
export type MixamValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: any;
  fileInfo?: {
    pageCount: number;
    coverPageCount: number;
    interiorPageCount: number;
    fileSize: number;
    coverDimensions?: { width: number; height: number };
    interiorDimensions?: { width: number; height: number };
  };
};

export type MixamOrderStatus =
  | 'draft'
  | 'validating'
  | 'validation_failed'
  | 'ready_to_submit'
  | 'awaiting_approval'
  | 'approved'
  | 'submitting'
  | 'submitted'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'failed';

// Print Product Configuration
export type PrintProduct = {
  id: string;
  name: string;
  description: string;
  active: boolean;

  // Page composition settings
  blankPages: number;    // Number of blank pages to include (e.g., 2 for front/back endpapers)
  spine: boolean;        // Whether the cover PDF includes a spine (hardcover typically true)

  // Mixam MxJdf specifications
  mixamSpec: {
    product: 'books';
    subProduct: 'hardcover_poth' | 'hardcover_pura' | 'paperback';

    // Cover component
    cover: {
      type: 'COVER';
      pages: 4; // Always 4 for hardcover
      material: {
        type: 'silk' | 'gloss' | 'uncoated' | 'linen' | 'buckram';
        weight: number; // GSM
        units: 'GSM';
        color: 'WHITE' | 'BLACK' | 'GREY' | 'CREAM';
        refinings?: Array<{
          type: 'LAMINATION' | 'UV' | 'FOIL';
          side: 'FRONT' | 'BACK' | 'FRONT_AND_BACK';
          effect: 'GLOSS' | 'MATT' | 'SOFT_TOUCH';
        }>;
      };
      chromaticity: {
        front: 'CMYK' | 'BW';
        back: 'CMYK' | 'BW';
      };
    };

    // Interior pages component
    interior: {
      type: 'CONTENT';
      material: {
        type: 'silk' | 'gloss' | 'uncoated';
        weight: number; // GSM
        units: 'GSM';
        color: 'WHITE' | 'CREAM' | 'YELLOW';
      };
      chromaticity: {
        front: 'CMYK' | 'BW';
        back: 'CMYK' | 'BW';
      };
    };

    // Binding configuration
    binding: {
      type: 'case' | 'case_with_sewing' | 'perfect_bound';
      sewn?: boolean;
      edge: 'LEFT_RIGHT' | 'TOP_BOTTOM';
      // User-selectable options
      allowHeadTailBandSelection?: boolean;
      allowRibbonSelection?: boolean;
      allowEndPaperSelection?: boolean;
    };

    // Format constraints
    format: {
      minPageCount: number;
      maxPageCount: number;
      pageCountIncrement: number; // Must be divisible by this (typically 4)
      allowedTrimSizes: Array<{
        width: number; // in mm
        height: number; // in mm
        label: string;
      }>;
      orientation: 'PORTRAIT' | 'LANDSCAPE' | 'SQUARE';
      bleedRequired: number; // in mm, typically 3.175 (0.125")
    };

    // File requirements
    files: {
      separateCoverAndInterior: boolean; // true for our case
      colorSpace: 'CMYK' | 'RGB';
      minDPI: number;
      maxFileSize: number; // in bytes
    };
  };

  // Pricing tiers (your cost from Mixam)
  pricingTiers: Array<{
    minQuantity: number;
    maxQuantity: number | null; // null = no upper limit
    basePrice: number; // Base cost per unit in GBP
    setupFee?: number;
  }>;

  // Shipping estimates (UK only initially)
  shippingCost: {
    baseRate: number; // GBP
    perItemRate?: number;
  };

  // Display
  imageUrl?: string;
  displayOrder: number;

  // Metadata
  createdAt: any;
  updatedAt: any;
  createdBy: string;

  // Direct Mixam catalogue mapping (optional - for precise control)
  // When set and validated, mxjdf-builder will use these exact IDs
  mixamMapping?: MixamProductMapping;
};

// Direct mapping to Mixam catalogue IDs
// These IDs come from Mixam's /api/public/catalogue and /api/public/products/metadata endpoints
export type MixamProductMapping = {
  productId: number;           // e.g., 7 for BOOK
  subProductId: number;        // e.g., 1 for Hardcover Photo Quality
  validated: boolean;          // Has this mapping been validated against catalogue?
  validatedAt?: any;           // Timestamp of last validation

  // Bound (interior) component settings
  boundComponent: {
    format: number;            // DIN format ID (0=A0, 1=A1, ..., 7=A7)
    standardSize?: string;     // Non-DIN size key (e.g., 'IN_8_5_X_11', 'SQUARE_210_MM')
    orientation: 'PORTRAIT' | 'LANDSCAPE';
    substrate: {
      typeId: number;          // Paper type ID (1=Silk, 2=Gloss, 3=Uncoated)
      weightId: number;        // Paper weight ID (from catalogue)
      colourId: number;        // Paper color ID (0=White)
    };
  };

  // Cover component settings
  coverComponent: {
    format: number;
    standardSize?: string;
    orientation: 'PORTRAIT' | 'LANDSCAPE';
    substrate: {
      typeId: number;
      weightId: number;
      colourId: number;
    };
    lamination: 'NONE' | 'GLOSS' | 'MATT' | 'SOFT_TOUCH';
    backColours: 'PROCESS' | 'NONE';  // NONE for hardcover (inner side glued to board)
  };

  // End papers component (required for hardcover/case-bound books)
  endPapersComponent?: {
    substrate: {
      typeId: number;
      weightId: number;
      colourId: number;
    };
  };

  // Binding settings
  binding: {
    type: 'PUR' | 'CASE' | 'STAPLED' | 'LOOP' | 'WIRO';
    edge: 'LEFT_RIGHT' | 'TOP_BOTTOM';
    sewn?: boolean;
  };
};

export type PrintOrder = {
  id?: string;
  parentUid: string;
  storyId: string;
  outputId: string;
  version: number;

  // Product Configuration
  printProductId: string;
  productSnapshot: PrintProduct; // Frozen copy at order time

  // Order specifications
  quantity: number;
  trimSize: {
    width: number; // mm
    height: number; // mm
    label: string;
  };
  pageCount: number;

  // User-selected options (if product allows)
  customOptions?: {
    endPaperColor?: string;
    headTailBandColor?: string;
    ribbonColor?: string;
  };

  // Address
  shippingAddress: PrintOrderAddress;
  contactEmail: string;

  // Status tracking
  paymentStatus: 'unpaid' | 'paid' | 'refunded';
  fulfillmentStatus: MixamOrderStatus;

  // Admin approval workflow
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvedBy?: string | null; // Admin user ID
  approvedAt?: any;
  rejectedBy?: string | null; // Admin user ID who rejected
  rejectedAt?: any;
  rejectedReason?: string | null;
  notificationAdminUid?: string | null; // Which admin to notify

  // Pre-submission validation results
  validationResult?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null;

  // Mixam integration
  mixamOrderId?: string | null;
  mixamJobNumber?: string | null;
  mixamStatus?: string | null;
  mixamValidation?: MixamValidationResult | null;
  mixamTrackingUrl?: string | null;
  mixamTrackingNumber?: string | null;
  mixamCarrier?: string | null;
  mixamEstimatedDelivery?: any;
  mixamSubmittedAt?: any;
  mixamFileReferences?: {
    coverFileId?: string | null;
    interiorFileId?: string | null;
  };

  // Status history
  statusHistory: Array<{
    status: string;
    timestamp: any;
    note?: string;
    source: 'system' | 'webhook' | 'admin' | 'parent';
    userId?: string;
  }>;

  // Process log - detailed event tracking for everything that happens to an order
  processLog?: Array<{
    event: string;          // e.g., 'order_created', 'validation_started', 'pdf_uploaded', 'mixam_submitted'
    timestamp: any;
    message: string;        // Human-readable description
    data?: Record<string, any>;  // Optional structured data (e.g., response codes, file IDs)
    source: 'system' | 'webhook' | 'admin' | 'parent' | 'mixam';
    userId?: string;        // Who triggered this event (if applicable)
  }>;

  // Estimated costs at order time (before Mixam submission)
  estimatedCost?: {
    unitPrice: number;
    subtotal: number;
    shipping: number;
    setupFee: number;
    total: number;
    currency: 'GBP';
  };

  // Costs (your actual costs from Mixam)
  mixamCost?: {
    printCost: number;
    shippingCost: number;
    setupFee: number;
    totalCost: number;
    currency: 'GBP';
    quotedAt: any;
  } | null;

  // Files (separate PDFs for cover, interior, and optional padding)
  printableFiles?: {
    coverPdfUrl?: string | null;
    interiorPdfUrl?: string | null;
    paddingPdfUrl?: string | null; // Blank pages to meet minimum page count
  };
  printablePdfUrl?: string | null; // Legacy: combined PDF
  printableMetadata?: PrintableAssetMetadata | null;

  // Standard fields
  createdAt: any;
  updatedAt: any;
  paymentMarkedAt?: any;
  paymentMarkedBy?: string | null;
  fulfillmentUpdatedAt?: any;
  fulfillmentNotes?: string | null;
  regressionTag?: string | null;
  regressionTest?: boolean;

  // Cancellation tracking
  cancelledAt?: any;
  cancellationReason?: string;
  cancelledBy?: string; // Admin user ID who cancelled

  // Mixam API interaction log - tracks all API calls and webhook events
  mixamInteractions?: MixamInteraction[];
};

// Tracks individual API calls to Mixam and webhook events received
export type MixamInteraction = {
  id: string; // Unique ID for this interaction
  timestamp: any; // When the interaction occurred
  type: 'api_request' | 'api_response' | 'webhook';

  // For API requests
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint?: string; // e.g., '/api/public/orders', '/api/public/orders/{id}/status'
  requestBody?: any; // Sanitized request payload (no auth tokens)

  // For API responses
  statusCode?: number;
  responseBody?: any; // Sanitized response (truncated if very large)
  durationMs?: number; // How long the API call took
  error?: string; // Error message if the call failed

  // For webhooks
  webhookEvent?: string; // e.g., 'order.status.updated', 'order.shipped'
  webhookPayload?: any; // The webhook payload received

  // Context
  action?: string; // Human-readable action (e.g., 'Submit Order', 'Cancel Order', 'Get Status')
  orderId?: string; // Mixam order ID if known
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

export type ChildProfile = {
    id: string;
    displayName: string;
    pronouns?: Pronouns; // Optional - defaults to they/them if not set
    dateOfBirth?: any; // Optional
    photos?: string[]; // Optional
    avatarUrl?: string; // AI-generatable avatar, optional
    // Dancing avatar animation (generated alongside avatar)
    avatarAnimationUrl?: string;
    avatarAnimationGeneration?: {
        status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
        lastRunAt?: any;
        lastCompletedAt?: any;
        lastErrorMessage?: string | null;
    };
    likes: string[]; // Replaces all preference subcategories
    dislikes: string[]; // New field for negative preferences
    description?: string;
    // AI-generated description of physical appearance from photos (for image generation prompts)
    // Internal field - not exposed to parents
    imageDescription?: string;
    imageDescriptionGeneration?: {
        status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
        lastRunAt?: any;
        lastCompletedAt?: any;
        lastErrorMessage?: string | null;
    };
    ownerParentUid: string;
    createdAt: any;
    updatedAt?: any;
    // Default print layout for this child - determines image dimensions during generation
    // Defaults to 'a4-portrait-spread-v1' if not set
    defaultPrintLayoutId?: string;

    // Pronunciation guide for the child's name (for TTS)
    // Can be phonetic spelling (e.g., "SEE-oh-ban" for Siobhan) or IPA
    namePronunciation?: string;

    // Preferred AI voice for TTS story reading
    // Can be an ElevenLabs preset voice ID or a parent's cloned voice ID
    preferredVoiceId?: string;

    // Whether to automatically read stories aloud when viewing in the story reader
    // Persists the "Read to Me" preference for this child
    autoReadAloud?: boolean;

    // Whether background music is enabled during story creation
    // Persists the music preference for this child (default: true)
    musicEnabled?: boolean;

    // Soft delete - set when parent "deletes" (hides) the profile
    // Only admins can permanently delete or restore
    deletedAt?: any;
    deletedBy?: string; // UID of the user who deleted
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

export type ArcStep = {
  id: string;
  label: string;
  guidance?: string;
  suggestsNewCharacter?: boolean;  // Hint to AI that this step is a good opportunity to introduce a new character
};

// === Story Type Prompt Configuration ===

export type StoryTypeModelConfig = {
  name: string;                    // e.g., 'googleai/gemini-2.5-pro'
  temperature?: number;            // Default: 0.7
  maxOutputTokens?: number;        // Default: 10000
};

export type StoryTypePromptConfig = {
  // Role & Identity (REQUIRED - no defaults)
  roleDefinition: string;          // Who the AI is for this story type
  behaviorRules: string[];         // Array of behavioral rules

  // Narrative Guidance
  narrativeStyle: string;          // Tone, voice, and style guidance
  thematicElements: string[];      // Key themes to weave throughout
  pacing: 'slow' | 'moderate' | 'fast';
  emotionalTone: 'gentle' | 'playful' | 'adventurous' | 'calm';

  // Per-Phase Instructions
  warmupInstructions?: string;     // For warmup phase
  storyBeatInstructions: string;   // For story beat generation
  endingInstructions?: string;     // For ending generation

  // Model Settings
  model: StoryTypeModelConfig;
};

export type StoryType = {
  id: string;
  name: string;
  shortDescription: string;
  // Age range - either can be undefined/null for "no limit"
  ageFrom?: number | null;  // Minimum age (inclusive), null/undefined = no minimum
  ageTo?: number | null;    // Maximum age (inclusive), null/undefined = no maximum
  /** @deprecated Use ageFrom/ageTo instead */
  ageRange?: string;
  status: "live" | "draft";
  tags: string[];

  // Arc structure
  arcTemplate: {
    steps: ArcStep[];
  };

  // Prompt configuration (merged from PromptConfig)
  promptConfig?: StoryTypePromptConfig;

  // Level band variations (optional - for age-appropriate adjustments)
  levelBandOverrides?: {
    [levelBand: string]: Partial<StoryTypePromptConfig>;
  };

  // Metadata
  version?: number;
  createdAt?: any;
  updatedAt?: any;

  // @deprecated - kept for backward compatibility during migration
  defaultPhaseId?: string;
  endingPhaseId?: string;
  levelBands?: string[];

  // Background music for story generation waiting screen
  backgroundMusic?: {
    prompt?: string;           // AI prompt for music generation
    audioUrl?: string | null;  // Firebase Storage URL
    storagePath?: string;      // Storage path for management
    durationMs?: number;       // Duration in milliseconds
    generation?: {
      status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
      lastRunAt?: any;
      lastCompletedAt?: any;
      lastErrorMessage?: string | null;
    };
  };
};

export type Character = {
    id: string;
    displayName: string;
    pronouns?: Pronouns; // Optional - defaults to they/them if not set
    dateOfBirth?: any; // Optional
    photos?: string[]; // Optional
    avatarUrl?: string; // AI-generatable avatar, optional
    // Dancing avatar animation (generated alongside avatar)
    avatarAnimationUrl?: string;
    avatarAnimationGeneration?: {
        status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
        lastRunAt?: any;
        lastCompletedAt?: any;
        lastErrorMessage?: string | null;
    };
    type: 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other'; // Replaces role
    // Relationship to the child (only applicable for type='Family')
    // e.g., 'mother', 'father', 'grandmother', 'grandfather', 'aunt', 'uncle', 'sibling', 'cousin'
    relationship?: string;
    // Pronunciation guide for the character's name (for TTS)
    // Can be phonetic spelling (e.g., "SEE-oh-ban" for Siobhan) or IPA
    namePronunciation?: string;
    likes: string[]; // New field (replaces traits)
    dislikes: string[]; // New field for negative preferences
    description?: string;
    // AI-generated description of physical appearance from photos (for image generation prompts)
    // Internal field - not exposed to parents
    imageDescription?: string;
    imageDescriptionGeneration?: {
        status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
        lastRunAt?: any;
        lastCompletedAt?: any;
        lastErrorMessage?: string | null;
    };
    ownerParentUid: string;
    childId?: string; // Optional: blank = family-wide, set = child-specific
    createdAt: Timestamp;
    updatedAt: Timestamp;

    // Character origin and usage tracking
    isParentGenerated?: boolean; // true = created by parent, false/undefined = AI-generated during story
    usageCount?: number; // Number of times this character has been used in stories
    lastUsedAt?: any; // Timestamp of when character was last used in a story

    // Soft delete - set when parent "deletes" (hides) the character
    // Only admins can permanently delete or restore
    deletedAt?: any;
    deletedBy?: string; // UID of the user who deleted
};


export type StoryOutputType = {
    id: string;
    name: string;
    status: "live" | "draft" | "archived";
    ageRange: string;
    shortDescription: string;
    childFacingLabel: string;
    category: "picture_book" | "poem" | "coloring_pages" | "audio_script";
    // Optional default print layout for this output type
    // When specified, images will be generated with dimensions from this layout
    // When not specified, image dimensions are unconstrained (default square)
    defaultPrintLayoutId?: string;
    // Display image for the output type card (shown to children when selecting)
    imageUrl?: string;
    // AI prompt for generating the display image
    imagePrompt?: string;
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
    // AI prompt for pagination - used by story-pagination-flow to transform and paginate story text
    paginationPrompt?: string;
    tags: string[];
    createdAt?: any;
    updatedAt?: any;
};

export type AppRoleMode = 'admin' | 'writer' | 'parent' | 'child' | 'unknown';

// Position for help wizard dialog card
export type HelpWizardPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center-center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export const DEFAULT_WIZARD_POSITION: HelpWizardPosition = 'bottom-center';

// Action to perform when advancing from a wizard page
export type HelpWizardAction = 'click'; // Click the highlighted element before advancing

export type HelpWizardPage = {
  title: string;
  description: string;
  route: string;
  highlightSelector?: string; // CSS selector for element to highlight (e.g., "#submit-btn", ".nav-menu")
  wizardTargetId?: string; // Unique identifier for targeting via data-wiz-target attribute
  position?: HelpWizardPosition; // Position of the help card on screen (default: bottom-center)
  action?: HelpWizardAction; // Action to perform when user advances (e.g., 'click' to click the element)
};

// Wizard Target Diagnostics - for showing target identifiers in editor mode
export type WizardTargetDiagnosticsConfig = {
  enabled: boolean;
  updatedAt?: any;
  updatedBy?: string;
};

export type StoryWizardAnswer = {
  question: string;
  answer: string;
};

export type StoryWizardChoice = {
  text: string;
};

export type StoryWizardInput = {
  childId: string;
  sessionId: string;
  answers?: StoryWizardAnswer[];
};

export type StoryWizardOutput =
  | {
      state: 'asking';
      question: string;
      choices: StoryWizardChoice[];
      answers: StoryWizardAnswer[];
      ok: true;
    }
  | {
      state: 'finished';
      title: string;
      vibe: string;
      storyText: string;
      storyId: string;
      ok: true;
    }
  | {
      state: 'error';
      error: string;
      ok: false;
    };

export type HelpWizardRole = 'parent' | 'writer' | 'admin';

export type HelpWizard = {
  id: string;
  title: string;
  pages: HelpWizardPage[];
  status: 'draft' | 'live';
  role: HelpWizardRole; // Who can see this wizard: parent, writer, or admin
  order: number; // Display order in help menu (lower numbers appear first)
  isDefaultStartup?: boolean; // If true, this wizard auto-starts for new users
  createdAt: any;
  updatedAt: any;
};

export type AIFlowLog = {
  id: string;
  flowName: string;
  status: 'success' | 'error' | 'failure';
  sessionId?: string;
  parentId?: string;
  prompt: string;
  response?: {
    text?: string | null;
    finishReason?: string | null;
    finishMessage?: string | null;
    model?: string | null;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    thoughtsTokens?: number;
    cachedContentTokens?: number;
  };
  latencyMs?: number;
  errorMessage?: string;
  /** Reason for failure when status is 'failure' (AI returned response but no usable output) */
  failureReason?: string;
  /** URL of generated image (for image generation flows) */
  imageUrl?: string;
  createdAt: any;
};

// AI Run Trace - Aggregates all AI calls for a story session
export type AICallTrace = {
  callId: string;
  flowName: string;
  timestamp: any;
  modelName: string;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  userMessages?: Array<{
    role: 'user' | 'model';
    content: string;
  }>;
  outputText: string;
  structuredOutput?: any;
  finishReason: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    thoughtsTokens?: number | null;
    cachedContentTokens?: number | null;
  };
  cost: {
    inputCost: number;
    outputCost: number;
    thinkingCost: number;
    cachedSavings: number;
    totalCost: number;
    currency: 'USD';
  };
  latencyMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
};

export type AIRunTrace = {
  sessionId: string;
  parentUid: string;
  childId?: string;
  storyTypeId?: string;
  storyTypeName?: string;
  startedAt: any;
  lastUpdatedAt: any;
  status: 'in_progress' | 'completed' | 'error';
  calls: AICallTrace[];
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCachedTokens: number;
    totalTokens: number;
    totalCost: number;
    totalLatencyMs: number;
    averageLatencyMs: number;
    callsByFlow: Record<string, number>;
    errorCount: number;
  };
};

// Page layout box position and size (in inches)
export type PageLayoutBox = {
  leaf?: 1 | 2;   // Which leaf in a spread (1 = left/first, 2 = right/second)
  x: number;      // inches from left edge of the leaf
  y: number;      // inches from top edge of the leaf
  width: number;  // inches
  height: number; // inches
};

// Text box with styling options
export type TextLayoutBox = PageLayoutBox & {
  backgroundColor?: string;  // hex color, e.g., '#F5F5DC' (cream)
  textColor?: string;        // hex color for text, defaults to contrasting color
  borderRadius?: number;     // corner radius in inches, defaults to 0
};

// Page layout configuration for a specific page type (cover, inside, back cover)
export type PageLayoutConfig = {
  textBoxEnabled?: boolean;   // Whether to show text box on this page type (default: true)
  imageBoxEnabled?: boolean;  // Whether to show image box on this page type (default: true)
  textBox?: TextLayoutBox;
  imageBox?: PageLayoutBox;
};

// Page type for layout resolution
export type PrintLayoutPageType = 'cover' | 'inside' | 'backCover' | 'titlePage';

// Page constraints for print layouts - controls story pagination and PDF generation
export type PrintLayoutPageConstraints = {
  minPages?: number;      // Minimum content pages (excluding covers)
  maxPages?: number;      // Maximum content pages
  pageMultiple?: 1 | 2 | 4;  // Pages must be divisible by this (1=any, 2=even, 4=multiple of 4)
};

export type PrintLayout = {
  id: string;
  name: string;
  leafWidth: number; // in inches
  leafHeight: number; // in inches
  leavesPerSpread: 1 | 2;
  createdAt?: any;
  updatedAt?: any;
  // Typography settings
  font?: string; // e.g., 'Helvetica', 'TimesRoman'
  fontSize?: number; // in points

  // Page-type-specific layouts
  coverLayout?: PageLayoutConfig;      // Front cover configuration
  backCoverLayout?: PageLayoutConfig;  // Back cover configuration
  insideLayout?: PageLayoutConfig;     // Interior pages configuration

  // Title page layout (optional, defaults to full-page centered text)
  titlePageLayout?: PageLayoutConfig;

  // Link to a PrintProduct for trim size and default constraints
  // When set, leafWidth/leafHeight should sync from the product's allowedTrimSizes
  printProductId?: string;

  // Page constraints for story pagination and PDF generation
  // If set, these override the linked PrintProduct's constraints
  pageConstraints?: PrintLayoutPageConstraints;

  // @deprecated - Legacy arrays, will be removed after migration
  // Use coverLayout, backCoverLayout, and insideLayout instead
  textBoxes?: Array<{
    leaf: 1 | 2;
    x: number; // in inches
    y: number; // in inches
    width: number; // in inches
    height: number; // in inches
  }>;
  imageBoxes?: Array<{
    leaf: 1 | 2;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

export type ImageStyleExampleImage = {
  id: string;           // UUID for deletion
  url: string;          // Firebase Storage URL
  storagePath: string;  // Path for deletion
  uploadedAt: any;      // Timestamp
};

export type ImageStyle = {
  id: string;
  title: string;
  description: string;
  ageRange: string; // Legacy display string
  ageFrom?: number | null; // Minimum age (0, null, or undefined = no minimum)
  ageTo?: number | null; // Maximum age (0, null, or undefined = no maximum)
  stylePrompt: string;
  sampleDescription: string;
  sampleImageUrl?: string | null;
  exampleImages?: ImageStyleExampleImage[]; // Reference images for AI generation
  preferred?: boolean; // If true, shown first in child-facing image style selection
  createdAt: any;
  updatedAt: any;
};

// ElevenLabs API version selection
// v2: eleven_multilingual_v2 - Current stable version, good for real-time TTS
// v3: eleven_v3 - Latest model with enhanced expressiveness, better for pre-generated content
export type ElevenLabsApiVersion = 'v2' | 'v3';

// System configuration for diagnostics and logging
export type DiagnosticsConfig = {
  id?: string;
  showDiagnosticsPanel: boolean;     // Show diagnostic cards on pages
  enableClientLogging: boolean;      // Console logs on client
  enableServerLogging: boolean;      // Detailed server logs
  enableAIFlowLogging: boolean;      // AI flow detailed logging
  showApiDocumentation: boolean;     // Expose API docs at /api-documentation
  enableMixamWebhookLogging: boolean; // Debug logging for Mixam webhooks
  showReportIssueButton: boolean;    // Show "Report Issue" button in header
  elevenLabsApiVersion: ElevenLabsApiVersion; // ElevenLabs TTS model version
  updatedAt?: any;
  updatedBy?: string;
};

// Default diagnostics config when none exists
export const DEFAULT_DIAGNOSTICS_CONFIG: DiagnosticsConfig = {
  showDiagnosticsPanel: false,
  enableClientLogging: false,
  enableServerLogging: true,
  enableAIFlowLogging: true,
  showApiDocumentation: false,
  enableMixamWebhookLogging: true, // Default on while testing
  showReportIssueButton: false,
  elevenLabsApiVersion: 'v3', // Default to latest v3 model (most expressive)
};

// Global prompt configuration - prepended to all AI prompts
export type GlobalPromptConfig = {
  globalPrefix: string;
  enabled: boolean;
  updatedAt?: any;
  updatedBy?: string;
};

export const DEFAULT_GLOBAL_PROMPT_CONFIG: GlobalPromptConfig = {
  globalPrefix: '',
  enabled: false,
};

// Compile prompt configuration - used by story-text-compile-flow to compile messages into story text
export type CompilePromptConfig = {
  compilePrompt: string;
  enabled: boolean;
  updatedAt?: any;
  updatedBy?: string;
};

export const DEFAULT_COMPILE_PROMPT_CONFIG: CompilePromptConfig = {
  compilePrompt: '',
  enabled: false,
};

// Pagination prompt configuration - used by story-pagination-flow to paginate story text
export type PaginationPromptConfig = {
  paginationPrompt: string;
  enabled: boolean;
  updatedAt?: any;
  updatedBy?: string;
};

// Default pagination prompt from story-pagination-flow.ts
export const DEFAULT_PAGINATION_PROMPT = `You are a children's book pagination expert. Take the story text and divide it into pages suitable for a children's picture book.

RULES:
1. Each page should have a natural amount of text for young children (2-4 short sentences, about 15-40 words)
2. Preserve ALL $$id$$ actor references exactly as they appear - do not change them
3. List which actor IDs (the IDs inside $$...$$) appear on each page in the actors array
4. Create natural narrative breaks between pages - end pages at scene changes or emotional beats
5. Build to a satisfying conclusion
6. Do not add or remove any content from the story - just divide it into pages
7. The first page should be an engaging opening, the last page should provide closure
8. For each page, write an imageDescription that describes what should be illustrated - include setting, action, mood, and which characters are present (use $$id$$ placeholders, same as in the text)`;

export const DEFAULT_PAGINATION_PROMPT_CONFIG: PaginationPromptConfig = {
  paginationPrompt: DEFAULT_PAGINATION_PROMPT,
  enabled: true, // Enabled by default since the prompt is required
};

// Image prompt configuration - global prefix for all image generation prompts
export type ImagePromptConfig = {
  imagePrompt: string;
  enabled: boolean;
  updatedAt?: any;
  updatedBy?: string;
};

// Default image generation prompt - prepended to all image generation requests
export const DEFAULT_IMAGE_PROMPT = `Create an illustration for a children's picture book. The image should be:
- Age-appropriate and gentle for young children (ages 3-7)
- Warm, inviting, and emotionally positive
- Free from scary, violent, or intense imagery
- Colorful and engaging with soft lighting`;

export const DEFAULT_IMAGE_PROMPT_CONFIG: ImagePromptConfig = {
  imagePrompt: DEFAULT_IMAGE_PROMPT,
  enabled: false, // Disabled by default, uses hardcoded prompt in flow
};

// Kids flow configuration - controls which story flows are available in /kids endpoint
export type KidsFlowConfig = {
  wizardEnabled: boolean;
  chatEnabled: boolean;
  gemini3Enabled: boolean;
  gemini4Enabled: boolean;
  friendsEnabled: boolean;
  updatedAt?: any;
  updatedBy?: string;
};

export const DEFAULT_KIDS_FLOW_CONFIG: KidsFlowConfig = {
  wizardEnabled: true,
  chatEnabled: true,
  gemini3Enabled: true,
  gemini4Enabled: true,
  friendsEnabled: true,
};

// Voice configuration - settings for voice cloning and TTS features
export type VoiceConfig = {
  // Text displayed for users to read when recording a family voice clone
  voiceRecordingText: string;
  updatedAt?: any;
  updatedBy?: string;
};

// Default voice recording script - designed to capture varied speaking patterns
export const DEFAULT_VOICE_RECORDING_TEXT = `Voice Clone Training Script
(Read in a clear, consistent, and natural speaking voice. Try to include varied pacing and emotional tone in different sections, as indicated by the suggested styles in brackets.)

[Neutral Introduction]
Hello. My name is [Your Name], and I am recording this text to provide a sample for a high-quality artificial intelligence voice clone. The goal is to create a realistic digital replica of my speaking patterns, tone, and overall vocal characteristics. This process requires a clear, quiet audio recording to capture all the essential details of my voice.

[Inquisitive and Engaging Tone]
Have you ever stopped to consider the incredible complexity of human speech? From the subtle variations in pitch and volume to the rhythm and flow of a simple sentence, our voices are truly unique. Every single person possesses a distinct acoustic fingerprint that AI models are now learning to replicate with astonishing accuracy. It's a fascinating blend of art and science, pushing the boundaries of what we thought was possible in digital communication. This ability to capture nuances brings a new dimension to how we interact with technology every day.

[Narrative/Storytelling Tone]
Imagine a scenario where an old sailor, weathered by a thousand storms, recounts his tales to a rapt audience. The sea salt in his voice, the long pauses for dramatic effect, the sudden bursts of excitement as he describes a near-miss with a leviathan of the deep. These are the elements that make storytelling so powerful and immersive. The AI is learning these very dynamics, not just the words themselves, but the life breathed into them through performance and expression.

[Descriptive and Detailed Tone]
The autumn air was crisp, carrying the scent of fallen leaves and distant woodsmoke. A lone raven soared across the deep crimson and gold sky, its wings casting a fleeting shadow over the ancient stone bridge below. The river, a silver ribbon winding through the valley, reflected the changing light of the fading afternoon. This picturesque landscape, a symphony of natural colors and textures, offers a peaceful moment of reflection amidst the hustle and bustle of modern life.

[Light-Hearted/Conversational Tone]
You won't believe what happened when I tried to bake a simple apple pie last weekend! Let's just say my kitchen turned into a chaotic scene from a slapstick comedy. Flour covered every surface, the apples had somehow rolled under the fridge, and I ended up ordering a pizza instead. Sometimes, the best-laid plans just go wonderfully awry, and you have to find the humor in the chaos.

[Concluding Remarks]
It's been a pleasure sharing this script with you today. The future of audio creation holds boundless opportunities, from accessibility tools to creative content generation. I look forward to hearing the result of this voice cloning process. Thank you for listening.`;

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voiceRecordingText: DEFAULT_VOICE_RECORDING_TEXT,
};

// Email template type keys - corresponds to the different email types
export type EmailTemplateType =
  | 'orderSubmitted'
  | 'orderStatusChanged'
  | 'orderApproved'
  | 'orderRejected'
  | 'orderCancelled'
  | 'testEmail'
  | 'maintenanceError';

// Individual email template configuration
export type EmailTemplate = {
  enabled: boolean;        // Whether this email type is active
  subject: string;         // Subject line (can include {{orderId}}, {{status}} placeholders)
  heading: string;         // Main heading in the email body
  bodyText: string;        // Intro paragraph text
  buttonText: string;      // Call-to-action button text
  buttonUrl?: string;      // Optional custom button URL (defaults to admin order page)
};

// Email configuration stored in systemConfig/email
export type EmailConfig = {
  // Sender settings
  senderEmail: string;     // The 'from' email address (must be valid in M365 tenant)
  senderName?: string;     // Optional display name for sender

  // Branding
  footerText: string;      // Footer text shown at bottom of all emails
  brandColor?: string;     // Primary button/accent color (hex, e.g., '#2563eb')

  // Per-template configuration
  templates: {
    [key in EmailTemplateType]: EmailTemplate;
  };

  // Metadata
  updatedAt?: any;
  updatedBy?: string;
};

// Default email configuration
export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  senderEmail: 'andrew.bale@rcnx.io',
  senderName: 'StoryPic Kids',
  footerText: 'This is an automated message from StoryPic Kids.',
  brandColor: '#2563eb',
  templates: {
    orderSubmitted: {
      enabled: true,
      subject: 'New Print Order: {{orderId}}',
      heading: 'New Print Order Submitted',
      bodyText: 'A new print order has been submitted and requires review.',
      buttonText: 'View Order in Admin',
    },
    orderStatusChanged: {
      enabled: true,
      subject: 'Print Order Status: {{orderId}} - {{status}}',
      heading: 'Print Order Status Changed',
      bodyText: 'An order status has been updated.',
      buttonText: 'View Order in Admin',
    },
    orderApproved: {
      enabled: true,
      subject: 'Print Order Approved: {{orderId}}',
      heading: 'Print Order Approved',
      bodyText: 'An order has been approved and submitted to the printer.',
      buttonText: 'View Order in Admin',
    },
    orderRejected: {
      enabled: true,
      subject: 'Print Order Rejected: {{orderId}}',
      heading: 'Print Order Rejected',
      bodyText: 'An order has been rejected.',
      buttonText: 'View Order in Admin',
    },
    orderCancelled: {
      enabled: true,
      subject: 'Print Order Cancelled: {{orderId}}',
      heading: 'Print Order Cancelled',
      bodyText: 'An order has been cancelled.',
      buttonText: 'View Order in Admin',
    },
    testEmail: {
      enabled: true,
      subject: 'Test Email from StoryPic Kids',
      heading: 'Test Email',
      bodyText: 'This is a test email to verify your email configuration is working correctly.',
      buttonText: 'Open Admin Dashboard',
    },
    maintenanceError: {
      enabled: true,
      subject: 'Error: {{flowName}} - {{errorType}}',
      heading: 'System Error Occurred',
      bodyText: 'An error occurred during processing that requires attention.',
      buttonText: 'View Admin Dashboard',
    },
  },
};

// ============================================================================
// Story Generator Types
// ============================================================================

/**
 * Capabilities that a story generator advertises to the StoryBrowser.
 * The browser adapts its UI based on these capabilities.
 */
export type StoryGeneratorCapabilities = {
  minChoices: number;                    // Minimum choices per question (e.g., 2)
  maxChoices: number;                    // Maximum choices per question (e.g., 4)
  supportsMoreOptions: boolean;          // Can request additional choices
  supportsCharacterIntroduction: boolean; // Can introduce new characters mid-story
  supportsFinalStory: boolean;           // Generates a final compiled story
  requiresStoryType: boolean;            // Needs story type selection first
};

/**
 * Styling configuration for a story generator.
 * Used by StoryBrowser to customize the appearance per generator.
 */
export type StoryGeneratorStyling = {
  gradient: string;                      // Tailwind gradient classes (e.g., 'from-purple-50 to-pink-50')
  darkGradient?: string;                 // Dark mode gradient (e.g., 'dark:from-purple-950 dark:to-pink-950')
  icon?: string;                         // Icon name (lucide) or URL
  loadingMessage: string;                // Message shown during generation
};

/**
 * Available AI models for story generation.
 */
export type AIModelName =
  | 'googleai/gemini-2.5-pro'
  | 'googleai/gemini-2.5-flash'
  | 'googleai/gemini-2.0-flash';

/**
 * Configuration for a specific prompt within a generator.
 * Allows per-prompt model and temperature settings.
 */
export type StoryGeneratorPromptConfig = {
  model?: AIModelName;                   // AI model to use (defaults to generator's default)
  temperature?: number;                  // Temperature 0.0-2.0 (defaults to generator's default)
};

/**
 * Background music generation status for story generators.
 */
export type StoryGeneratorMusicGeneration = {
  status: 'idle' | 'pending' | 'generating' | 'ready' | 'error';
  lastRunAt?: any;
  lastCompletedAt?: any;
  lastErrorMessage?: string | null;
};

/**
 * Background music configuration for story generators.
 * Matches the pattern used by storyTypes.
 */
export type StoryGeneratorBackgroundMusic = {
  prompt?: string;                       // AI prompt for music generation
  audioUrl?: string | null;              // Firebase Storage URL
  storagePath?: string;                  // Storage path for management
  durationMs?: number;                   // Duration in milliseconds
  generation?: StoryGeneratorMusicGeneration;
};

/**
 * A story generator configuration document.
 * Stored in Firestore collection: storyGenerators
 */
export type StoryGenerator = {
  id: string;                            // e.g., 'wizard', 'gemini3', 'gemini4', 'beat', 'friends'
  name: string;                          // Display name
  description: string;                   // For admin UI
  status: 'live' | 'draft' | 'archived';
  order?: number;                        // Display order on story creation pages (lower = first)

  capabilities: StoryGeneratorCapabilities;
  apiEndpoint: string;                   // e.g., '/api/storyWizard', '/api/gemini3'
  styling: StoryGeneratorStyling;

  // Whether this generator is available in the /kids endpoint
  enabledForKids?: boolean;

  // Background music (optional, extended config)
  backgroundMusic?: StoryGeneratorBackgroundMusic;

  // AI Prompts (editable in Firestore, keyed by purpose)
  // Keys are generator-specific, e.g., 'questionGeneration', 'storyGeneration', 'phaseOpening'
  prompts?: Record<string, string>;

  // Default AI model for this generator (can be overridden per-prompt)
  defaultModel?: AIModelName;

  // Default temperature for this generator (can be overridden per-prompt)
  defaultTemperature?: number;

  // Per-prompt model and temperature configuration
  // Keys match the prompts keys, e.g., 'scenarioGeneration', 'storyGeneration'
  promptConfig?: Record<string, StoryGeneratorPromptConfig>;

  // Metadata
  createdAt?: any;
  updatedAt?: any;
};

/**
 * Standard response format for all story generators.
 * All generator APIs must return this shape.
 */
export type StoryGeneratorResponseOption = {
  id: string;
  text: string;                          // With $$placeholders$$
  textResolved?: string;                 // Resolved for display
  introducesCharacter?: boolean;
  newCharacterName?: string;
  newCharacterLabel?: string;
  newCharacterType?: string;
  existingCharacterId?: string;
  isMoreOption?: boolean;                // True for "Tell me more" option (gemini4)
};

export type StoryGeneratorResponse = {
  ok: boolean;
  sessionId: string;

  // Content
  headerText?: string;                   // Story continuation (beat mode) - with $$placeholders$$
  headerTextResolved?: string;           // Resolved for display
  question: string;                      // The question/prompt - with $$placeholders$$
  questionResolved?: string;             // Resolved for display
  options: StoryGeneratorResponseOption[];

  // State
  isStoryComplete?: boolean;
  finalStory?: string;                   // With $$placeholders$$
  finalStoryResolved?: string;           // Resolved for display

  // Progress indicator (0.0 to 1.0)
  // Monotonically increasing estimate of how far through story generation we are.
  // 0.0 = just started, 1.0 = complete
  progress?: number;

  // Ending options (beat mode ending flow)
  isEndingPhase?: boolean;

  // Friends flow specific (character/scenario/synopsis selection)
  friendsPhase?: FriendsPhase;
  proposedCharacters?: FriendsCharacterOption[];
  availableCharacters?: FriendsCharacterOption[];
  scenarios?: FriendsScenario[];
  synopses?: FriendsSynopsis[];

  // Debug/Error
  debug?: Record<string, any>;
  errorMessage?: string;
};

// ============================================================================
// "Fun with my friends" Story Generator Types
// ============================================================================

/**
 * Phases of the friends story generator flow.
 */
export type FriendsPhase =
  | 'character_selection'    // AI proposes characters, child confirms or modifies
  | 'scenario_selection'     // AI proposes adventure scenarios
  | 'synopsis_selection'     // AI drafts story synopses for chosen scenario
  | 'story_generation'       // AI writes full story
  | 'complete';              // Story is complete

/**
 * A character option shown during friend selection.
 */
export type FriendsCharacterOption = {
  id: string;
  displayName: string;
  type: 'child' | 'sibling' | 'Family' | 'Friend' | 'Pet' | 'Toy' | 'Other';
  avatarUrl?: string;
  isSelected: boolean;
};

/**
 * A scenario option for the story adventure.
 */
export type FriendsScenario = {
  id: string;                            // e.g., 'A', 'B', 'C'
  title: string;                         // Short title
  description: string;                   // 1-2 sentence description
};

/**
 * A story synopsis option drafted by AI.
 */
export type FriendsSynopsis = {
  id: string;                            // e.g., 'A', 'B', 'C'
  title: string;                         // Story title
  summary: string;                       // 2-3 sentence summary
};

// ============================================================================
// Answer Animation Types
// ============================================================================

/**
 * Type of answer animation - either for removing non-selected answers
 * or for celebrating/exiting the selected answer.
 */
export type AnswerAnimationType = 'exit' | 'selection';

/**
 * Generation status for sound effects.
 */
export type AnswerAnimationSoundEffectStatus = 'idle' | 'generating' | 'ready' | 'error';

/**
 * Sound effect configuration for an animation.
 * Generated via ElevenLabs text-to-sound-effects API.
 */
export type AnswerAnimationSoundEffect = {
  prompt: string;                        // ElevenLabs SFX prompt (e.g., "whoosh sound, quick swoosh")
  durationSeconds: number;               // 0.5-30 seconds (ElevenLabs parameter)
  promptInfluence?: number;              // 0-1 (ElevenLabs parameter, default 0.3)
  audioUrl?: string | null;              // Firebase Storage URL after generation
  storagePath?: string;                  // Storage path for cleanup
  generation: {
    status: AnswerAnimationSoundEffectStatus;
    lastRunAt?: any;
    lastCompletedAt?: any;
    lastErrorMessage?: string | null;
  };
};

/**
 * An answer animation configuration stored in Firestore.
 * Collection: answerAnimations
 */
export type AnswerAnimation = {
  id: string;                            // Document ID (e.g., 'exit-slide-left', 'selection-celebrate')
  name: string;                          // Display name (e.g., 'Slide Left')
  type: AnswerAnimationType;             // 'exit' or 'selection'
  cssKeyframes: string;                  // CSS @keyframes definition
  cssAnimationName: string;              // Name of the animation in @keyframes
  durationMs: number;                    // Animation duration in milliseconds (default: 500)
  easing: string;                        // CSS easing function (default: 'ease-out')
  isActive: boolean;                     // Whether this animation is available for use
  order: number;                         // Display order in admin

  // Sound effect configuration (optional)
  soundEffect?: AnswerAnimationSoundEffect;

  // Metadata
  createdAt: any;
  updatedAt: any;
};

// ============================================================================
// AI Models Configuration
// ============================================================================

/**
 * AI Models configuration stored in systemConfig/aiModels
 * Used to centrally manage which AI models are used across the application
 */
export type AIModelsConfig = {
  // Image generation model (e.g., 'googleai/gemini-2.5-flash-image')
  imageGenerationModel: string;

  // Primary text model for complex tasks (e.g., 'googleai/gemini-2.5-pro')
  primaryTextModel: string;

  // Lightweight text model for simple tasks (e.g., 'googleai/gemini-2.5-flash')
  lightweightTextModel: string;

  // Legacy text model for specific use cases (e.g., 'googleai/gemini-2.0-flash')
  legacyTextModel: string;

  // Availability status from last check
  availabilityCheck?: AIModelAvailabilityCheck;

  // Metadata
  updatedAt?: any;
  updatedBy?: string;
};

/**
 * Default AI model configuration
 */
export const DEFAULT_AI_MODELS_CONFIG: AIModelsConfig = {
  imageGenerationModel: 'googleai/gemini-2.5-flash-image',
  primaryTextModel: 'googleai/gemini-2.5-pro',
  lightweightTextModel: 'googleai/gemini-2.5-flash',
  legacyTextModel: 'googleai/gemini-2.0-flash',
};

/**
 * Result of checking model availability against Google AI API
 */
export type AIModelAvailabilityCheck = {
  lastCheckedAt: any;
  status: 'ok' | 'warning' | 'error';
  issues: AIModelIssue[];
  availableModels?: GoogleAIModelInfo[];
};

/**
 * An issue with a configured model
 */
export type AIModelIssue = {
  model: string;
  configKey: keyof AIModelsConfig;
  issue: 'deprecated' | 'unavailable' | 'unknown';
  message: string;
};

/**
 * Model info from Google AI API ListModels response
 */
export type GoogleAIModelInfo = {
  name: string;                           // e.g., 'models/gemini-2.5-pro'
  displayName: string;
  description?: string;
  version?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  // Derived fields
  category?: 'text' | 'image' | 'embedding' | 'other';
  isImageGeneration?: boolean;
};

// ============================================================================
// Development Todo Types
// ============================================================================

/**
 * Status of a development todo item.
 * - pending: Not yet started
 * - in_progress: Currently being worked on
 * - partial: Partially completed with a comment explaining what remains
 * - completed: Fully done
 */
export type DevTodoStatus = 'pending' | 'in_progress' | 'partial' | 'completed';

/**
 * Priority level for development todos.
 */
export type DevTodoPriority = 'low' | 'medium' | 'high';

/**
 * A development todo item tracked in Firestore.
 * Collection: devTodos
 *
 * These items are used to track work that should be done for a production-ready system.
 * Both admins and Claude can add items to this list.
 */
export type DevTodo = {
  id: string;                             // Document ID
  title: string;                          // Short description of the work item
  description?: string;                   // Detailed description (optional)
  status: DevTodoStatus;                  // Current status
  priority: DevTodoPriority;              // Priority level
  partialComment?: string;                // Comment when status is 'partial'

  // Tracking who created/modified this item
  createdBy: 'admin' | 'claude';          // Who created this item
  createdByEmail?: string;                // Email of admin who created (if admin)
  completedBy?: 'admin' | 'claude';       // Who completed this item
  completedByEmail?: string;              // Email of admin who completed (if admin)

  // Optional categorization
  category?: string;                      // e.g., 'security', 'performance', 'UX', 'testing'
  relatedFiles?: string[];                // Relevant file paths

  // Metadata
  createdAt: any;
  updatedAt: any;
  completedAt?: any;
};
