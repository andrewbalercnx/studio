export type Role = 'user' | 'assistant' | 'system';

export type Choice = {
    id: string;
    text: string;
    value?: string;
};

export type ChatMessage = {
    id: string;
    role: Role;
    content: string;
    choices?: Choice[];
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
    // This is a client-side representation and not stored in Firestore directly
    // with the session document. It's populated from the messages sub-collection.
    messages: ChatMessage[];
};
