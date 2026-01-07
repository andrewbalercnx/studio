/**
 * StoryPic API Client
 *
 * Provides typed methods for all child-facing API operations.
 */
import type { Story, StorySession, StoryBookOutput, StoryOutputPage, StoryGenerator, StoryOutputType, ImageStyle, StoryGeneratorResponse, StoryCompileResponse, StorybookPagesResponse, StorybookImagesResponse, GenerationStatus } from '@storypic/shared-types';
/**
 * Configuration for the StoryPic API client.
 */
export type StoryPicClientConfig = {
    /** Base URL for API requests (e.g., '/api' or 'https://storypic.com/api') */
    baseUrl: string;
    /** Function to get the current Firebase ID token */
    getToken: () => Promise<string>;
    /** Optional timeout in milliseconds (default: 60000) */
    timeout?: number;
};
/**
 * Error thrown by the API client.
 */
export declare class StoryPicApiError extends Error {
    readonly status: number;
    readonly code?: string | undefined;
    constructor(message: string, status: number, code?: string | undefined);
}
/**
 * StoryPic API Client for child-facing features.
 */
export declare class StoryPicClient {
    private baseUrl;
    private getToken;
    private timeout;
    constructor(config: StoryPicClientConfig);
    private request;
    private get;
    private post;
    /**
     * Get available story generators for kids.
     * This is a public endpoint (no auth required).
     */
    getGenerators(): Promise<StoryGenerator[]>;
    /**
     * Get available story output types (picture book, poem, etc.).
     * Note: This fetches from Firestore client-side in the current PWA.
     * TODO: Add server endpoint for this.
     */
    getOutputTypes(): Promise<StoryOutputType[]>;
    /**
     * Get available image styles for storybook illustrations.
     * Note: This fetches from Firestore client-side in the current PWA.
     * TODO: Add server endpoint for this.
     */
    getImageStyles(): Promise<ImageStyle[]>;
    /**
     * Create a new story session for a generator.
     * Note: Session creation is currently done client-side via Firestore.
     * TODO: Add server endpoint for session creation.
     */
    createSession(childId: string, generatorId: string): Promise<StorySession>;
    /**
     * Send a choice to the wizard generator.
     */
    sendWizardChoice(sessionId: string, optionId?: string): Promise<StoryGeneratorResponse>;
    /**
     * Send a choice to the beat-based generator.
     */
    sendBeatChoice(sessionId: string, optionId?: string, moreOptions?: boolean): Promise<StoryGeneratorResponse>;
    /**
     * Send a choice/action to the friends generator.
     */
    sendFriendsAction(sessionId: string, optionId?: string, action?: 'confirm_characters' | 'change_characters' | 'more_synopses', selectedCharacterIds?: string[]): Promise<StoryGeneratorResponse>;
    /**
     * Send a choice/message to the gemini3 generator.
     */
    sendGemini3Choice(sessionId: string, optionId?: string, userMessage?: string): Promise<StoryGeneratorResponse>;
    /**
     * Send a choice/message to the gemini4 generator.
     */
    sendGemini4Choice(sessionId: string, optionId?: string, userMessage?: string): Promise<StoryGeneratorResponse>;
    /**
     * Compile a story session into a final story.
     */
    compileStory(sessionId: string): Promise<StoryCompileResponse>;
    /**
     * Create a new storybook output for a story.
     * Note: Storybook creation is currently done client-side via Firestore.
     * TODO: Add server endpoint for storybook creation.
     */
    createStorybook(storyId: string, outputTypeId: string, styleId: string): Promise<StoryBookOutput>;
    /**
     * Generate pages for a storybook (pagination).
     */
    generatePages(storyId: string, storybookId: string, storyOutputTypeId: string): Promise<StorybookPagesResponse>;
    /**
     * Generate images for storybook pages.
     */
    generateImages(storyId: string, storybookId: string, imageStyleId: string): Promise<StorybookImagesResponse>;
    /**
     * Get the generation status of a storybook.
     * Note: Status is currently fetched client-side via Firestore subscription.
     * TODO: Add server endpoint for status polling.
     */
    getStorybookStatus(storyId: string, storybookId: string): Promise<{
        pageGeneration: GenerationStatus;
        imageGeneration: GenerationStatus;
        isFinalized: boolean;
    }>;
    /**
     * Get pages for a storybook.
     * Note: Pages are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for fetching pages.
     */
    getStorybookPages(storyId: string, storybookId: string): Promise<StoryOutputPage[]>;
    /**
     * Get a story by ID.
     * Note: Stories are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for fetching stories.
     */
    getStory(storyId: string): Promise<Story>;
    /**
     * Get all stories for a child.
     * Note: Stories are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for listing stories.
     */
    getMyStories(childId: string): Promise<Story[]>;
    /**
     * Get all storybooks for a child.
     * Note: Storybooks are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for listing storybooks.
     */
    getMyStorybooks(childId: string): Promise<StoryBookOutput[]>;
    /**
     * Generate text-to-speech audio.
     * Returns a URL to the audio file.
     */
    speak(text: string, voiceId?: string, childId?: string): Promise<string>;
}
//# sourceMappingURL=client.d.ts.map