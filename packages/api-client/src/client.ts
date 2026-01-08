/**
 * StoryPic API Client
 *
 * Provides typed methods for all child-facing API operations.
 */

import type {
  Story,
  StorySession,
  StoryBookOutput,
  StoryOutputPage,
  StoryGenerator,
  StoryOutputType,
  ImageStyle,
  ChildProfile,
  Character,
  StoryGeneratorResponse,
  StoryCompileResponse,
  KidsGeneratorsResponse,
  StorybookPagesResponse,
  StorybookImagesResponse,
  TTSResponse,
  StoryWizardRequest,
  StoryFriendsRequest,
  StoryGeminiRequest,
  StoryBeatRequest,
  StoryCompileRequest,
  StorybookPagesRequest,
  StorybookImagesRequest,
  TTSRequest,
  GenerationStatus,
} from '@storypic/shared-types';

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
export class StoryPicApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'StoryPicApiError';
  }
}

/**
 * StoryPic API Client for child-facing features.
 */
export class StoryPicClient {
  private baseUrl: string;
  private getToken: () => Promise<string>;
  private timeout: number;

  constructor(config: StoryPicClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.getToken = config.getToken;
    this.timeout = config.timeout ?? 60000;
  }

  // ============================================================================
  // Private HTTP helpers
  // ============================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
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
        throw new StoryPicApiError(
          data.errorMessage || data.error || 'Request failed',
          response.status,
          data.code
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof StoryPicApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new StoryPicApiError('Request timeout', 408);
      }
      throw new StoryPicApiError(
        error instanceof Error ? error.message : 'Network error',
        0
      );
    }
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  // ============================================================================
  // Discovery (public endpoints)
  // ============================================================================

  /**
   * Get available story generators for kids.
   * This is a public endpoint (no auth required).
   */
  async getGenerators(): Promise<StoryGenerator[]> {
    const response = await this.get<KidsGeneratorsResponse>('/kids-generators');
    if (!response.ok) {
      throw new StoryPicApiError(response.errorMessage || 'Failed to get generators', 500);
    }
    return response.generators;
  }

  /**
   * Get available story output types (picture book, poem, etc.).
   */
  async getOutputTypes(): Promise<StoryOutputType[]> {
    const response = await this.get<{ ok: boolean; outputTypes: StoryOutputType[]; error?: string }>('/storyOutputTypes');
    if (!response.ok) {
      throw new StoryPicApiError(response.error || 'Failed to get output types', 500);
    }
    return response.outputTypes;
  }

  /**
   * Get available image styles for storybook illustrations.
   */
  async getImageStyles(): Promise<ImageStyle[]> {
    const response = await this.get<{ ok: boolean; imageStyles: ImageStyle[]; error?: string }>('/imageStyles');
    if (!response.ok) {
      throw new StoryPicApiError(response.error || 'Failed to get image styles', 500);
    }
    return response.imageStyles;
  }

  // ============================================================================
  // Story Creation
  // ============================================================================

  /**
   * Create a new story session for a generator.
   * Note: Session creation is currently done client-side via Firestore.
   * TODO: Add server endpoint for session creation.
   */
  async createSession(childId: string, generatorId: string): Promise<StorySession> {
    // For now, throw not implemented - sessions created client-side
    throw new StoryPicApiError('Not implemented - create session via Firestore', 501);
  }

  /**
   * Send a choice to the wizard generator.
   */
  async sendWizardChoice(
    sessionId: string,
    optionId?: string
  ): Promise<StoryGeneratorResponse> {
    const body: StoryWizardRequest = { sessionId, selectedOptionId: optionId };
    return this.post<StoryGeneratorResponse>('/storyWizard', body);
  }

  /**
   * Send a choice to the beat-based generator.
   */
  async sendBeatChoice(
    sessionId: string,
    optionId?: string,
    moreOptions?: boolean
  ): Promise<StoryGeneratorResponse> {
    const body: StoryBeatRequest = { sessionId, selectedOptionId: optionId, moreOptions };
    return this.post<StoryGeneratorResponse>('/storyBeat', body);
  }

  /**
   * Send a choice/action to the friends generator.
   */
  async sendFriendsAction(
    sessionId: string,
    optionId?: string,
    action?: 'confirm_characters' | 'change_characters' | 'more_synopses',
    selectedCharacterIds?: string[]
  ): Promise<StoryGeneratorResponse> {
    const body: StoryFriendsRequest = {
      sessionId,
      selectedOptionId: optionId,
      action,
      selectedCharacterIds,
    };
    return this.post<StoryGeneratorResponse>('/storyFriends', body);
  }

  /**
   * Send a choice/message to the gemini3 generator.
   */
  async sendGemini3Choice(
    sessionId: string,
    optionId?: string,
    userMessage?: string
  ): Promise<StoryGeneratorResponse> {
    const body: StoryGeminiRequest = {
      sessionId,
      selectedOptionId: optionId,
      userMessage,
    };
    return this.post<StoryGeneratorResponse>('/gemini3', body);
  }

  /**
   * Send a choice/message to the gemini4 generator.
   */
  async sendGemini4Choice(
    sessionId: string,
    optionId?: string,
    userMessage?: string
  ): Promise<StoryGeneratorResponse> {
    const body: StoryGeminiRequest = {
      sessionId,
      selectedOptionId: optionId,
      userMessage,
    };
    return this.post<StoryGeneratorResponse>('/gemini4', body);
  }

  /**
   * Compile a story session into a final story.
   */
  async compileStory(sessionId: string): Promise<StoryCompileResponse> {
    const body: StoryCompileRequest = { sessionId };
    return this.post<StoryCompileResponse>('/storyCompile', body);
  }

  // ============================================================================
  // Storybook Generation
  // ============================================================================

  /**
   * Create a new storybook output for a story.
   * Note: Storybook creation is currently done client-side via Firestore.
   * TODO: Add server endpoint for storybook creation.
   */
  async createStorybook(
    storyId: string,
    outputTypeId: string,
    styleId: string
  ): Promise<StoryBookOutput> {
    // For now, throw not implemented - storybooks created client-side
    throw new StoryPicApiError('Not implemented - create storybook via Firestore', 501);
  }

  /**
   * Generate pages for a storybook (pagination).
   */
  async generatePages(
    storyId: string,
    storybookId: string,
    storyOutputTypeId: string
  ): Promise<StorybookPagesResponse> {
    const body: StorybookPagesRequest = { storyId, storybookId, storyOutputTypeId };
    return this.post<StorybookPagesResponse>('/storybookV2/pages', body);
  }

  /**
   * Generate images for storybook pages.
   */
  async generateImages(
    storyId: string,
    storybookId: string,
    imageStyleId: string
  ): Promise<StorybookImagesResponse> {
    const body: StorybookImagesRequest = { storyId, storybookId, imageStyleId };
    return this.post<StorybookImagesResponse>('/storybookV2/images', body);
  }

  /**
   * Get the generation status of a storybook.
   * Note: Status is currently fetched client-side via Firestore subscription.
   * TODO: Add server endpoint for status polling.
   */
  async getStorybookStatus(
    storyId: string,
    storybookId: string
  ): Promise<{
    pageGeneration: GenerationStatus;
    imageGeneration: GenerationStatus;
    isFinalized: boolean;
  }> {
    // For now, throw not implemented - use Firestore subscription
    throw new StoryPicApiError('Not implemented - use Firestore subscription', 501);
  }

  /**
   * Get pages for a storybook.
   * Pages are returned sorted by pageNumber, with blank/title pages filtered out.
   * Placeholders in displayText are resolved server-side.
   */
  async getStorybookPages(
    storyId: string,
    storybookId: string
  ): Promise<StoryOutputPage[]> {
    return this.get<StoryOutputPage[]>(`/stories/${storyId}/storybooks/${storybookId}/pages`);
  }

  // ============================================================================
  // Reading/Viewing
  // ============================================================================

  /**
   * Get a story by ID.
   * Returns story with resolved placeholders in title, synopsis, and storyText.
   */
  async getStory(storyId: string): Promise<Story> {
    return this.get<Story>(`/stories/${storyId}`);
  }

  /**
   * Get all stories for a child.
   * Stories are returned sorted by createdAt descending (most recent first).
   * Soft-deleted stories are excluded.
   */
  async getMyStories(childId: string): Promise<Story[]> {
    return this.get<Story[]>(`/stories?childId=${childId}`);
  }

  /**
   * Get all storybooks for a story.
   * By default only returns storybooks with imageGeneration.status === 'ready'.
   * Pass includeAll=true to get all storybooks.
   */
  async getMyStorybooks(storyId: string, includeAll?: boolean): Promise<StoryBookOutput[]> {
    const query = includeAll ? '?includeAll=true' : '';
    return this.get<StoryBookOutput[]>(`/stories/${storyId}/storybooks${query}`);
  }

  // ============================================================================
  // TTS (Text-to-Speech)
  // ============================================================================

  /**
   * Generate text-to-speech audio.
   * Returns a URL to the audio file.
   */
  async speak(text: string, voiceId?: string, childId?: string): Promise<string> {
    const body: TTSRequest = { text, voiceId, childId };
    const response = await this.post<TTSResponse>('/tts', body);
    if (!response.ok || !response.audioUrl) {
      throw new StoryPicApiError(response.errorMessage || 'TTS generation failed', 500);
    }
    return response.audioUrl;
  }
}
