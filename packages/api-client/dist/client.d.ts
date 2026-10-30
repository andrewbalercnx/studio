/**
 * StoryPic API Client
 *
 * Provides typed methods for all child-facing API operations.
 */
import type { ChildInput, CreateStoryRequest, CreationModeView, StoryOutputType, ImageStyle, StoryStatus, StoryTurnResult, StoryTurnView, StoryView } from '@storypic/shared-types';
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
    /** Routes on the shared route wrapper answer `{ ok: true, data }`. */
    private data;
    /**
     * The ways a child can make a story: live modes enabled for kids, in display
     * order, presented kid-safely, exactly one `recommended`.
     */
    listCreationModes(): Promise<CreationModeView[]>;
    /**
     * Get available story output types (picture book, poem, etc.).
     */
    getOutputTypes(): Promise<StoryOutputType[]>;
    /**
     * Get available image styles for storybook illustrations.
     */
    getImageStyles(): Promise<ImageStyle[]>;
    /**
     * Start creating a Story. `idempotencyKey` must be made once per tap and
     * repeated on a retry of that tap: the server then returns the same Story
     * and first turn (`created: false`). 402 ENTITLEMENT_LIMIT when the family
     * has no story allowance left.
     */
    createStory(input: CreateStoryRequest): Promise<StoryTurnResult>;
    /**
     * Send the child's answer to the latest prompt (a choice, typed text or a
     * cast pick, as the turn's `expects` says). One `idempotencyKey` per
     * answer: a repeat returns the recorded reply. 409 TURN_IN_PROGRESS means
     * the same answer is still being worked on (repeat it later); 409
     * TURN_CONFLICT means another answer was recorded first; 503 means the AI
     * was unavailable and nothing was recorded (repeat it).
     */
    sendTurn(storyId: string, input: ChildInput, idempotencyKey: string): Promise<StoryTurnResult>;
    /** Stop creating a Story (only while `creating`; idempotent). */
    abandonStory(storyId: string): Promise<{
        storyId: string;
        status: StoryStatus;
    }>;
    /** A Story that `failed` while finishing goes back to `finishing`. */
    retryFinish(storyId: string): Promise<{
        storyId: string;
        status: StoryStatus;
    }>;
    /**
     * Create a Book: the story's words in a Form (the Manuscript, paginated on
     * the server with the Form's default length and density) drawn in a Style.
     * The server runs the whole pipeline; the caller only watches the Book.
     *
     * `idempotencyKey` must be made once per user action (e.g. one "make my
     * book" tap) and repeated on a retry of that action: the server then returns
     * the same Book and charges the book allowance once.
     */
    createBook(input: {
        storyId: string;
        formId: string;
        styleId: string;
        idempotencyKey: string;
    }): Promise<{
        bookId: string;
        manuscriptId: string;
        status: string;
        created: boolean;
    }>;
    /**
     * A Story and its turns. Every text (title, synopsis, finished text, each
     * prompt and option) is rendered with names on the server.
     */
    getStory(storyId: string): Promise<{
        story: StoryView;
        turns: StoryTurnView[];
    }>;
    /**
     * The child's Stories, newest first, with the server's status. Abandoned
     * Stories are left out.
     */
    getMyStories(childId: string): Promise<StoryView[]>;
    /**
     * Generate text-to-speech audio.
     * Returns a URL to the audio file.
     */
    speak(text: string, voiceId?: string, childId?: string): Promise<string>;
}
//# sourceMappingURL=client.d.ts.map