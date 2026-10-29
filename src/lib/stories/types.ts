/**
 * Client-side views of Stories (slice 5.4).
 *
 * While a Story is being created the browser reads `stories/{id}` and its
 * `turns` directly (owner read-only rules) and changes them only through the
 * creation routes (`src/lib/stories/api.ts`). Lists and readers use the API's
 * rendered views (`GET /api/stories`, `GET /api/stories/{id}`), where names
 * are resolved on the server. The server schemas live in
 * `src/server/data/schemas/story.ts` (firebase-admin, not bundled for the
 * browser); these types mirror what the UI reads.
 */
import type { Timestamp } from 'firebase/firestore';

export type CreationModeId = 'wizard' | 'freeplay' | 'guided' | 'friends' | 'adventure';
export type StoryStatus = 'creating' | 'finishing' | 'complete' | 'abandoned' | 'failed';
export type TurnExpects = 'choice' | 'text' | 'castPick';

/** `stories/{storyId}` as the play screen reads it. */
export type StoryDoc = {
  id: string;
  ownerUid: string;
  childId: string;
  modeId: CreationModeId;
  status: StoryStatus;
  turnCount: number;
  error: { code: string; message: string } | null;
  createdAt?: Timestamp;
};

export type TurnOption = { id: string; display: string; preselected?: boolean };

/** `stories/{storyId}/turns/{index}`. */
export type TurnDoc = {
  id: string;
  ownerUid: string;
  index: number;
  role: 'ai' | 'child';
  kind: 'prompt' | 'input' | 'done';
  promptDisplay: string | null;
  options: TurnOption[] | null;
  expects: TurnExpects | null;
  progress: { step: number; of: number | null } | null;
  inputDisplay: string | null;
};

/** What the creation routes answer (`POST /api/stories`, `POST /api/stories/{id}/turns`). */
export type StoryTurnResult = {
  storyId: string;
  status: StoryStatus;
  turn: {
    index: number;
    kind: TurnDoc['kind'];
    promptDisplay: string | null;
    options: TurnOption[] | null;
    expects: TurnExpects | null;
    progress: TurnDoc['progress'];
  };
  created: boolean;
};

export type StoryCastView = {
  castId: string;
  kind: 'child' | 'character';
  role: 'hero' | 'supporting';
  displayName: string;
  avatarUrl: string | null;
};

/** `GET /api/stories` and `GET /api/stories/{id}`: texts rendered with names. */
export type StoryView = {
  id: string;
  childId: string;
  modeId: CreationModeId;
  storyTypeId: string | null;
  status: StoryStatus;
  title: string | null;
  synopsis: string | null;
  text: string | null;
  cast: StoryCastView[];
  turnCount: number;
  error: { code: string; message: string } | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

export type StoryTurnView = Omit<TurnDoc, 'id' | 'ownerUid'> & { addedCast: string[] };

/** `GET /api/creation-modes`. */
export type CreationModeView = {
  modeId: CreationModeId;
  name: string;
  description: string;
  icon: string | null;
  gradient: string | null;
  darkGradient: string | null;
  loadingMessage: string | null;
  recommended: boolean;
};

/** Kid-facing words for a Story's server status. */
export function storyStatusLabel(status: StoryStatus): string {
  switch (status) {
    case 'creating':
      return 'Still being made';
    case 'finishing':
      return 'Finishing touches…';
    case 'complete':
      return 'Story ready';
    case 'failed':
      return 'Got a bit stuck';
    case 'abandoned':
      return 'Stopped';
  }
}

/** The prompt the child should answer now: the latest AI prompt turn, if the Story is waiting for input. */
export function currentPrompt(turns: TurnDoc[]): TurnDoc | null {
  const latest = turns.reduce<TurnDoc | null>((acc, t) => (acc === null || t.index > acc.index ? t : acc), null);
  return latest && latest.role === 'ai' && latest.kind === 'prompt' ? latest : null;
}
