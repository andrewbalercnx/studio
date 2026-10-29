import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAuth } from './AuthContext';

// API base URL - use your deployed backend
const API_BASE_URL = 'https://storypic.rcnx.io';

// ============================================
// Types (mirror @storypic/api-client; the app is API-only)
// ============================================

export type CreationModeId = 'wizard' | 'freeplay' | 'guided' | 'friends' | 'adventure';
export type StoryStatus = 'creating' | 'finishing' | 'complete' | 'abandoned' | 'failed';
export type TurnExpects = 'choice' | 'text' | 'castPick';

export interface CreationMode {
  modeId: CreationModeId;
  name: string;
  description: string;
  icon: string | null;
  loadingMessage: string | null;
  recommended: boolean;
}

export interface StoryCastMember {
  castId: string;
  kind: 'child' | 'character';
  role: 'hero' | 'supporting';
  displayName: string;
  avatarUrl: string | null;
}

/** A Story with every text rendered with names (GET /api/stories, GET /api/stories/{id}). */
export interface StoryView {
  id: string;
  childId: string;
  modeId: CreationModeId;
  status: StoryStatus;
  title: string | null;
  synopsis: string | null;
  text: string | null;
  cast: StoryCastMember[];
  turnCount: number;
  error: { code: string; message: string } | null;
  createdAt: string | null;
  completedAt: string | null;
}

export interface TurnOption {
  id: string;
  display: string;
  preselected: boolean;
}

export interface StoryTurn {
  index: number;
  role: 'ai' | 'child';
  kind: 'prompt' | 'input' | 'done';
  promptDisplay: string | null;
  options: TurnOption[] | null;
  expects: TurnExpects | null;
  progress: { step: number; of: number | null } | null;
  inputDisplay: string | null;
}

export type ChildInput =
  | { kind: 'choice'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'castPick'; castIds: string[] };

/** POST /api/stories and POST /api/stories/{id}/turns. */
export interface StoryTurnResult {
  storyId: string;
  status: StoryStatus;
  turn: StoryTurn;
  created: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A fresh idempotency key: one per user action, repeated on a retry of that action. */
export function newIdempotencyKey(): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `m-${Date.now().toString(36)}-${random()}${random()}`;
}

// Simplified API client for mobile
// This mirrors the @storypic/api-client but is self-contained for the mobile app
class MobileApiClient {
  private baseUrl: string;
  private getToken: () => Promise<string | null>;

  constructor(config: { baseUrl: string; getToken: () => Promise<string | null> }) {
    this.baseUrl = config.baseUrl;
    this.getToken = config.getToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });
    } catch {
      throw new ApiError('We could not reach the story maker. Check the connection and try again.', 'NETWORK', 0);
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      let code = 'REQUEST_FAILED';
      try {
        const errorJson = JSON.parse(errorText);
        // Routes on the shared wrapper answer { ok: false, error: { code, message } }.
        const envelope = typeof errorJson.error === 'object' && errorJson.error !== null ? errorJson.error : null;
        errorMessage = envelope?.message || errorJson.error || errorJson.message || `HTTP ${response.status}`;
        code = envelope?.code || errorJson.code || code;
      } catch {
        errorMessage = errorText || `HTTP ${response.status}`;
      }
      throw new ApiError(errorMessage, code, response.status);
    }

    return response.json();
  }

  /** Routes on the shared wrapper answer `{ ok: true, data }`. */
  private async data<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const body = await this.request<{ ok: boolean; data: T }>(endpoint, options);
    return body.data;
  }

  // ============================================
  // Discovery
  // ============================================

  /** The ways a child can make a story (live, enabled for kids, kid-safe presentation). */
  async listCreationModes(): Promise<CreationMode[]> {
    const data = await this.data<{ modes: CreationMode[] }>('/api/creation-modes');
    return data.modes || [];
  }

  // ============================================
  // Child data
  // ============================================

  async getChildren(): Promise<any[]> {
    return this.request('/api/children');
  }

  async getChild(childId: string): Promise<any> {
    return this.request(`/api/children/${childId}`);
  }

  /** The child's Stories, newest first (server status, names resolved). */
  async getMyStories(childId: string): Promise<StoryView[]> {
    const data = await this.data<{ stories: StoryView[] }>(`/api/stories?childId=${encodeURIComponent(childId)}`);
    return data.stories || [];
  }

  /** A Story and its turns. */
  async getStory(storyId: string): Promise<{ story: StoryView; turns: StoryTurn[] }> {
    return this.data(`/api/stories/${encodeURIComponent(storyId)}`);
  }

  // ============================================
  // Story creation (POST /api/stories and the turn routes)
  // ============================================

  /** Start a Story; `idempotencyKey` is one per tap (a repeat returns the same Story). */
  async createStory(input: { childId: string; modeId: CreationModeId; idempotencyKey: string }): Promise<StoryTurnResult> {
    return this.data('/api/stories', { method: 'POST', body: JSON.stringify(input) });
  }

  /** The child's answer; repeat the same key on a retry so the server records it once. */
  async sendTurn(storyId: string, input: ChildInput, idempotencyKey: string): Promise<StoryTurnResult> {
    return this.data(`/api/stories/${encodeURIComponent(storyId)}/turns`, {
      method: 'POST',
      body: JSON.stringify({ input, idempotencyKey }),
    });
  }

  async abandonStory(storyId: string): Promise<{ storyId: string; status: StoryStatus }> {
    return this.data(`/api/stories/${encodeURIComponent(storyId)}/abandon`, { method: 'POST' });
  }

  /** A Story that failed to finish goes back to finishing. */
  async retryFinish(storyId: string): Promise<{ storyId: string; status: StoryStatus }> {
    return this.data(`/api/stories/${encodeURIComponent(storyId)}/finish`, { method: 'POST' });
  }

  // ============================================
  // TTS
  // ============================================

  async speak(text: string, voiceId?: string): Promise<string> {
    const response = await this.request<{ audioUrl: string }>('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voiceId }),
    });
    return response.audioUrl;
  }

  // ============================================
  // PIN verification
  // ============================================

  async verifyPin(pin: string): Promise<{ valid: boolean }> {
    return this.request('/api/parent/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  }
}

/** Kid-safe words for a failed creation call (server copy for allowance is already written for children). */
export function kidSafeMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'ENTITLEMENT_LIMIT' || error.code === 'INPUT_NOT_EXPECTED') return error.message;
    if (error.code === 'TURN_CONFLICT') return 'Another answer got there first. Here is the newest question!';
    if (error.code === 'NETWORK') return error.message;
    if (error.status === 503 || error.code === 'TURN_IN_PROGRESS') return 'The storyteller needs a little breather. Let’s try again!';
    if (error.code.startsWith('MODE_')) return 'That way of making a story is resting right now. Pick another one!';
  }
  return "Something went a little wonky! Don't worry — your ideas are safe. Let's try again.";
}

const ApiClientContext = createContext<MobileApiClient | null>(null);

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  const client = useMemo(
    () =>
      new MobileApiClient({
        baseUrl: API_BASE_URL,
        getToken,
      }),
    [getToken]
  );

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient() {
  const context = useContext(ApiClientContext);
  if (!context) {
    throw new Error('useApiClient must be used within an ApiClientProvider');
  }
  return context;
}
