/**
 * Client-side views of Stories (slice 5.4).
 *
 * While a Story is being created the browser reads `stories/{id}` and its
 * `turns` directly (owner read-only rules) and changes them only through the
 * creation routes (`api.stories`, `src/lib/api.ts`). Lists and readers use the API's
 * rendered views (`GET /api/stories`, `GET /api/stories/{id}`), where names
 * are resolved on the server. The server schemas live in
 * `src/server/data/schemas/story.ts` (firebase-admin, not bundled for the
 * browser); these types mirror what the UI reads.
 */
import type { Timestamp } from 'firebase/firestore';
import type { CreationModeId, StoryStatus, TurnExpects } from '@storypic/shared-types';

/** The API's views (`GET /api/stories…`, the creation routes) are defined once, in `@storypic/shared-types`. */
export type {
  CreationModeId,
  CreationModeView,
  StoryCastView,
  StoryStatus,
  StoryTurnResult,
  StoryTurnView,
  StoryView,
  TurnExpects,
} from '@storypic/shared-types';
export { storyStatusLabel } from '@storypic/api-client';

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

/** The prompt the child should answer now: the latest AI prompt turn, if the Story is waiting for input. */
export function currentPrompt(turns: TurnDoc[]): TurnDoc | null {
  const latest = turns.reduce<TurnDoc | null>((acc, t) => (acc === null || t.index > acc.index ? t : acc), null);
  return latest && latest.role === 'ai' && latest.kind === 'prompt' ? latest : null;
}
