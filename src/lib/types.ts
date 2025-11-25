
'use client';

import type { Timestamp } from 'firebase/firestore';

export type Role = 'user' | 'assistant' | 'system';

export type Choice = {
    id: string;
    text: string;
    value?: string;
    introducesCharacter?: boolean;
    newCharacterLabel?: string | null;
    newCharacterKind?: 'toy' | 'pet' | 'friend' | 'family' | 'other' | null;
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
    kind?: 'beat_continuation' | 'beat_options' | 'child_choice' | 'character_traits_question' | 'character_traits_answer';
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
    // The overall status of the story session.
    status: 'in_progress' | 'completed';
    // The current phase of the story creation process.
    // warmup: gathering info, story: main beats, ending: choosing an ending, final: story is compiled.
    currentPhase: 'warmup' | 'story' | 'ending' | 'final';
    currentStepIndex: number;
    storyTitle?: string;
    storyVibe?: string;
    finalStoryText?: string;
    createdAt: Date;
    updatedAt: Date;
    promptConfigId?: string;
    promptConfigLevelBand?: string;
    storyTypeId?: string;
    storyPhaseId?: string;
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
    // This is a client-side representation and not stored in Firestore directly
    // with the session document. It's populated from the messages sub-collection.
    messages: ChatMessage[];
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
	createdAt: Date;
	estimatedLevel: number;
	favouriteGenres: string[];
	favouriteCharacterTypes: string[];
	preferredStoryLength: 'short' | 'medium' | 'long';
	helpPreference: 'more_scaffolding' | 'balanced' | 'independent';
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
    layoutHints: {
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
