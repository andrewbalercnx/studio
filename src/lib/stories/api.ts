'use client';

/**
 * Calls to the creation routes (slice 5.3/5.4). Every change to a Story goes
 * through these; the browser never writes `stories` or `turns` (ADR-0005).
 */
import { authFetch } from '@/lib/auth-fetch';
import type { CreationModeId, CreationModeView, StoryStatus, StoryTurnResult, StoryTurnView, StoryView } from './types';

export class StoryApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'StoryApiError';
  }
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await authFetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StoryApiError('We could not reach the story maker. Check the connection and try again.', 'NETWORK', 0);
  }
  let payload: { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new StoryApiError(
      payload?.error?.message || 'Something went wrong. Please try again.',
      payload?.error?.code || 'REQUEST_FAILED',
      response.status
    );
  }
  return payload.data as T;
}

export type ChildInput =
  | { kind: 'choice'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'castPick'; castIds: string[] };

export type CreateStoryRequest = {
  childId: string;
  modeId: CreationModeId;
  castIds?: string[];
  storyTypeId?: string;
  /** One per tap; a repeat returns the same Story and first turn. */
  idempotencyKey: string;
};

export function createStory(input: CreateStoryRequest): Promise<StoryTurnResult> {
  return request<StoryTurnResult>('POST', '/api/stories', input);
}

/** One key per submit; repeating it (a double tap, a retry) returns the recorded reply. */
export function sendTurn(storyId: string, input: ChildInput, idempotencyKey: string): Promise<StoryTurnResult> {
  return request<StoryTurnResult>('POST', `/api/stories/${encodeURIComponent(storyId)}/turns`, { input, idempotencyKey });
}

export function abandonStory(storyId: string): Promise<{ storyId: string; status: StoryStatus }> {
  return request('POST', `/api/stories/${encodeURIComponent(storyId)}/abandon`);
}

/** A Story that `failed` while finishing goes back to `finishing` with a new job. */
export function retryFinish(storyId: string): Promise<{ storyId: string; status: StoryStatus }> {
  return request('POST', `/api/stories/${encodeURIComponent(storyId)}/finish`);
}

export async function listStories(childId: string): Promise<StoryView[]> {
  const data = await request<{ stories: StoryView[] }>('GET', `/api/stories?childId=${encodeURIComponent(childId)}`);
  return data.stories;
}

export function getStory(storyId: string): Promise<{ story: StoryView; turns: StoryTurnView[] }> {
  return request('GET', `/api/stories/${encodeURIComponent(storyId)}`);
}

export async function listCreationModes(): Promise<CreationModeView[]> {
  const data = await request<{ modes: CreationModeView[] }>('GET', '/api/creation-modes');
  return data.modes;
}

/** Errors the play screen answers by waiting and sending the same request again. */
export function isRetryLater(error: unknown): boolean {
  return error instanceof StoryApiError && (error.code === 'TURN_IN_PROGRESS' || error.status === 503 || error.status === 0);
}

/**
 * Kid-safe words for a failed creation call. The server's messages for
 * allowance and availability are already written for children; anything else
 * becomes friendly copy (raw errors stay in the console).
 */
export function kidSafeMessage(error: unknown): string {
  if (error instanceof StoryApiError) {
    switch (error.code) {
      case 'ENTITLEMENT_LIMIT':
        return error.message;
      case 'MODE_NOT_LIVE':
      case 'MODE_NOT_FOR_KIDS':
      case 'MODE_NOT_FOUND':
        return 'That way of making a story is resting right now. Pick another one!';
      case 'TURN_CONFLICT':
        return 'Another answer got there first. Here is the newest question!';
      case 'TURN_IN_PROGRESS':
      case 'AI_UNAVAILABLE':
      case 'AI_BAD_OUTPUT':
        return 'The storyteller needs a little breather. Let’s try again!';
      case 'INPUT_NOT_EXPECTED':
        return error.message;
      case 'STORY_NOT_CREATING':
        return 'This story is already finished!';
      case 'NETWORK':
        return 'We could not reach the story maker. Check the connection and try again.';
    }
  }
  return "Something went a little wonky! Don't worry — your ideas are safe. Let's try again.";
}
