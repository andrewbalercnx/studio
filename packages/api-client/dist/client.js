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
                // Older routes answer { errorMessage | error: string }; routes on the
                // shared route wrapper answer { ok: false, error: { code, message } }.
                const envelope = typeof data.error === 'object' && data.error !== null ? data.error : null;
                throw new StoryPicApiError(envelope?.message || data.errorMessage || data.error || 'Request failed', response.status, envelope?.code || data.code);
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
    /** Routes on the shared route wrapper answer `{ ok: true, data }`. */
    async data(method, path, body) {
        const response = await this.request(method, path, body);
        return response.data;
    }
    // ============================================================================
    // Discovery
    // ============================================================================
    /**
     * The ways a child can make a story: live modes enabled for kids, in display
     * order, presented kid-safely, exactly one `recommended`.
     */
    async listCreationModes() {
        const data = await this.data('GET', '/creation-modes');
        return data.modes;
    }
    /**
     * Get available story output types (picture book, poem, etc.).
     */
    async getOutputTypes() {
        const response = await this.get('/storyOutputTypes');
        if (!response.ok) {
            throw new StoryPicApiError(response.error || 'Failed to get output types', 500);
        }
        return response.outputTypes;
    }
    /**
     * Get available image styles for storybook illustrations.
     */
    async getImageStyles() {
        const response = await this.get('/imageStyles');
        if (!response.ok) {
            throw new StoryPicApiError(response.error || 'Failed to get image styles', 500);
        }
        return response.imageStyles;
    }
    // ============================================================================
    // Story Creation (one Story, five modes, the same routes for every client)
    // ============================================================================
    /**
     * Start creating a Story. `idempotencyKey` must be made once per tap and
     * repeated on a retry of that tap: the server then returns the same Story
     * and first turn (`created: false`). 402 ENTITLEMENT_LIMIT when the family
     * has no story allowance left.
     */
    async createStory(input) {
        return this.data('POST', '/stories', input);
    }
    /**
     * Send the child's answer to the latest prompt (a choice, typed text or a
     * cast pick, as the turn's `expects` says). One `idempotencyKey` per
     * answer: a repeat returns the recorded reply. 409 TURN_IN_PROGRESS means
     * the same answer is still being worked on (repeat it later); 409
     * TURN_CONFLICT means another answer was recorded first; 503 means the AI
     * was unavailable and nothing was recorded (repeat it).
     */
    async sendTurn(storyId, input, idempotencyKey) {
        return this.data('POST', `/stories/${encodeURIComponent(storyId)}/turns`, { input, idempotencyKey });
    }
    /** Stop creating a Story (only while `creating`; idempotent). */
    async abandonStory(storyId) {
        return this.data('POST', `/stories/${encodeURIComponent(storyId)}/abandon`);
    }
    /** A Story that `failed` while finishing goes back to `finishing`. */
    async retryFinish(storyId) {
        return this.data('POST', `/stories/${encodeURIComponent(storyId)}/finish`);
    }
    // ============================================================================
    // Books
    // ============================================================================
    /**
     * Create a Book: the story's words in a Form (the Manuscript, paginated on
     * the server with the Form's default length and density) drawn in a Style.
     * The server runs the whole pipeline; the caller only watches the Book.
     *
     * `idempotencyKey` must be made once per user action (e.g. one "make my
     * book" tap) and repeated on a retry of that action: the server then returns
     * the same Book and charges the book allowance once.
     */
    async createBook(input) {
        const response = await this.post('/books', input);
        if (!response.ok || !response.data?.bookId) {
            throw new StoryPicApiError('Failed to create book', 500);
        }
        return response.data;
    }
    // ============================================================================
    // Reading/Viewing
    // ============================================================================
    /**
     * A Story and its turns. Every text (title, synopsis, finished text, each
     * prompt and option) is rendered with names on the server.
     */
    async getStory(storyId) {
        return this.data('GET', `/stories/${encodeURIComponent(storyId)}`);
    }
    /**
     * The child's Stories, newest first, with the server's status. Abandoned
     * Stories are left out.
     */
    async getMyStories(childId) {
        const data = await this.data('GET', `/stories?childId=${encodeURIComponent(childId)}`);
        return data.stories;
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