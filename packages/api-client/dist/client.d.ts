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
     */
    getOutputTypes(): Promise<StoryOutputType[]>;
    /**
     * Get available image styles for storybook illustrations.
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
     * The server handles print layout lookup and image dimension calculation.
     *
     * @param storyId - The story to create a storybook for
     * @param outputTypeId - The story output type (e.g., "picture-book", "poem")
     * @param styleId - The image style ID
     * @param imageStylePrompt - The style prompt for image generation
     * @returns The ID of the created storybook
     */
    createStorybook(storyId: string, outputTypeId: string, styleId: string, imageStylePrompt: string): Promise<string>;
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
     * Pages are returned sorted by pageNumber, with blank/title pages filtered out.
     * Placeholders in displayText are resolved server-side.
     */
    getStorybookPages(storyId: string, storybookId: string): Promise<StoryOutputPage[]>;
    /**
     * Get a story by ID.
     * Returns story with resolved placeholders in title, synopsis, and storyText.
     */
    getStory(storyId: string): Promise<Story>;
    /**
     * Get all stories for a child.
     * Stories are returned sorted by createdAt descending (most recent first).
     * Soft-deleted stories are excluded.
     */
    getMyStories(childId: string): Promise<Story[]>;
    /**
     * Get all storybooks for a story.
     * By default only returns storybooks with imageGeneration.status === 'ready'.
     * Pass includeAll=true to get all storybooks.
     */
    getMyStorybooks(storyId: string, includeAll?: boolean): Promise<StoryBookOutput[]>;
    /**
     * Generate text-to-speech audio.
     * Returns a URL to the audio file.
     */
    speak(text: string, voiceId?: string, childId?: string): Promise<string>;
}
//# sourceMappingURL=client.d.ts.map