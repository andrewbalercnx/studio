export type Role = 'user' | 'assistant';

export type Choice = {
    id: string;
    text: string;
};

export type ChatMessage = {
    id: string;
    role: Role;
    content: string;
    choices?: Choice[];
};

export type StorySession = {
    id: string;
    userId: string;
    vibe?: string;
    characters: { name: string; description: string }[];
    storyArc: string[];
    fullStoryText?: string;
    createdAt: Date;
    messages: ChatMessage[];
};
