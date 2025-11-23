

'use client';

export type Role = 'user' | 'assistant' | 'system';

export type Choice = {
    id: string;
    text: string;
    value?: string;
};

export type ChatMessage = {
    id: string;
    // This is different from the Genkit role, which is 'user' | 'assistant' | 'system'
    sender: 'child' | 'assistant' | 'system';
    text: string;
    createdAt: any; // Allow for server timestamp or Date
    choices?: Choice[];
    // For Genkit compatibility
    role?: 'user' | 'model' | 'system' | 'tool';
    content?: string;
};

export type Character = {
    name: string;
    type: 'self' | 'friend' | 'family' | 'pet' | 'imaginary';
    traits: string[];
    goal: string;
};

export type StoryBeat = {
    label: string;
    childPlanText: string;
    draftText: string;
};

export type StorySession = {
    id: string;
    childId: string;
    status: 'in_progress' | 'completed';
    currentPhase: string;
    currentStepIndex: number;
    storyTitle?: string;
    storyVibe?: string;
    characters: Character[];
    beats: StoryBeat[];
    finalStoryText?: string;
    createdAt: Date;
    updatedAt: Date;
    promptConfigId?: string;
    promptConfigLevelBand?: string;
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


    