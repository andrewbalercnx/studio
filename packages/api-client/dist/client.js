"use strict";
/**
 * StoryPic API Client
 *
 * Provides typed methods for all child-facing API operations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoryPicClient = exports.StoryPicApiError = void 0;
/**
 * Error thrown by the API client.
 */
class StoryPicApiError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'StoryPicApiError';
    }
}
exports.StoryPicApiError = StoryPicApiError;
/**
 * StoryPic API Client for child-facing features.
 */
class StoryPicClient {
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.getToken = config.getToken;
        this.timeout = config.timeout ?? 60000;
    }
    // ============================================================================
    // Private HTTP helpers
    // ============================================================================
    async request(method, path, body) {
        const token = await this.getToken();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            const data = await response.json();
            if (!response.ok) {
                throw new StoryPicApiError(data.errorMessage || data.error || 'Request failed', response.status, data.code);
            }
            return data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof StoryPicApiError) {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw new StoryPicApiError('Request timeout', 408);
            }
            throw new StoryPicApiError(error instanceof Error ? error.message : 'Network error', 0);
        }
    }
    async get(path) {
        return this.request('GET', path);
    }
    async post(path, body) {
        return this.request('POST', path, body);
    }
    // ============================================================================
    // Discovery (public endpoints)
    // ============================================================================
    /**
     * Get available story generators for kids.
     * This is a public endpoint (no auth required).
     */
    async getGenerators() {
        const response = await this.get('/kids-generators');
        if (!response.ok) {
            throw new StoryPicApiError(response.errorMessage || 'Failed to get generators', 500);
        }
        return response.generators;
    }
    /**
     * Get available story output types (picture book, poem, etc.).
     * Note: This fetches from Firestore client-side in the current PWA.
     * TODO: Add server endpoint for this.
     */
    async getOutputTypes() {
        // For now, throw not implemented - will need server endpoint
        throw new StoryPicApiError('Not implemented - use Firestore directly', 501);
    }
    /**
     * Get available image styles for storybook illustrations.
     * Note: This fetches from Firestore client-side in the current PWA.
     * TODO: Add server endpoint for this.
     */
    async getImageStyles() {
        // For now, throw not implemented - will need server endpoint
        throw new StoryPicApiError('Not implemented - use Firestore directly', 501);
    }
    // ============================================================================
    // Story Creation
    // ============================================================================
    /**
     * Create a new story session for a generator.
     * Note: Session creation is currently done client-side via Firestore.
     * TODO: Add server endpoint for session creation.
     */
    async createSession(childId, generatorId) {
        // For now, throw not implemented - sessions created client-side
        throw new StoryPicApiError('Not implemented - create session via Firestore', 501);
    }
    /**
     * Send a choice to the wizard generator.
     */
    async sendWizardChoice(sessionId, optionId) {
        const body = { sessionId, selectedOptionId: optionId };
        return this.post('/storyWizard', body);
    }
    /**
     * Send a choice to the beat-based generator.
     */
    async sendBeatChoice(sessionId, optionId, moreOptions) {
        const body = { sessionId, selectedOptionId: optionId, moreOptions };
        return this.post('/storyBeat', body);
    }
    /**
     * Send a choice/action to the friends generator.
     */
    async sendFriendsAction(sessionId, optionId, action, selectedCharacterIds) {
        const body = {
            sessionId,
            selectedOptionId: optionId,
            action,
            selectedCharacterIds,
        };
        return this.post('/storyFriends', body);
    }
    /**
     * Send a choice/message to the gemini3 generator.
     */
    async sendGemini3Choice(sessionId, optionId, userMessage) {
        const body = {
            sessionId,
            selectedOptionId: optionId,
            userMessage,
        };
        return this.post('/gemini3', body);
    }
    /**
     * Send a choice/message to the gemini4 generator.
     */
    async sendGemini4Choice(sessionId, optionId, userMessage) {
        const body = {
            sessionId,
            selectedOptionId: optionId,
            userMessage,
        };
        return this.post('/gemini4', body);
    }
    /**
     * Compile a story session into a final story.
     */
    async compileStory(sessionId) {
        const body = { sessionId };
        return this.post('/storyCompile', body);
    }
    // ============================================================================
    // Storybook Generation
    // ============================================================================
    /**
     * Create a new storybook output for a story.
     * Note: Storybook creation is currently done client-side via Firestore.
     * TODO: Add server endpoint for storybook creation.
     */
    async createStorybook(storyId, outputTypeId, styleId) {
        // For now, throw not implemented - storybooks created client-side
        throw new StoryPicApiError('Not implemented - create storybook via Firestore', 501);
    }
    /**
     * Generate pages for a storybook (pagination).
     */
    async generatePages(storyId, storybookId, storyOutputTypeId) {
        const body = { storyId, storybookId, storyOutputTypeId };
        return this.post('/storybookV2/pages', body);
    }
    /**
     * Generate images for storybook pages.
     */
    async generateImages(storyId, storybookId, imageStyleId) {
        const body = { storyId, storybookId, imageStyleId };
        return this.post('/storybookV2/images', body);
    }
    /**
     * Get the generation status of a storybook.
     * Note: Status is currently fetched client-side via Firestore subscription.
     * TODO: Add server endpoint for status polling.
     */
    async getStorybookStatus(storyId, storybookId) {
        // For now, throw not implemented - use Firestore subscription
        throw new StoryPicApiError('Not implemented - use Firestore subscription', 501);
    }
    /**
     * Get pages for a storybook.
     * Note: Pages are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for fetching pages.
     */
    async getStorybookPages(storyId, storybookId) {
        // For now, throw not implemented - use Firestore
        throw new StoryPicApiError('Not implemented - use Firestore', 501);
    }
    // ============================================================================
    // Reading/Viewing
    // ============================================================================
    /**
     * Get a story by ID.
     * Note: Stories are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for fetching stories.
     */
    async getStory(storyId) {
        // For now, throw not implemented - use Firestore
        throw new StoryPicApiError('Not implemented - use Firestore', 501);
    }
    /**
     * Get all stories for a child.
     * Note: Stories are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for listing stories.
     */
    async getMyStories(childId) {
        // For now, throw not implemented - use Firestore
        throw new StoryPicApiError('Not implemented - use Firestore', 501);
    }
    /**
     * Get all storybooks for a child.
     * Note: Storybooks are currently fetched client-side via Firestore.
     * TODO: Add server endpoint for listing storybooks.
     */
    async getMyStorybooks(childId) {
        // For now, throw not implemented - use Firestore
        throw new StoryPicApiError('Not implemented - use Firestore', 501);
    }
    // ============================================================================
    // TTS (Text-to-Speech)
    // ============================================================================
    /**
     * Generate text-to-speech audio.
     * Returns a URL to the audio file.
     */
    async speak(text, voiceId, childId) {
        const body = { text, voiceId, childId };
        const response = await this.post('/tts', body);
        if (!response.ok || !response.audioUrl) {
            throw new StoryPicApiError(response.errorMessage || 'TTS generation failed', 500);
        }
        return response.audioUrl;
    }
}
exports.StoryPicClient = StoryPicClient;
//# sourceMappingURL=client.js.map