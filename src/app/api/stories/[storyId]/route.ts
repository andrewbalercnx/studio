import { getCreationReadDb, getStoryWithTurns } from '@/server/creation';
import { withRoute } from '@/server/http';

/**
 * GET /api/stories/{storyId} — one of the caller's Stories and its turns
 * (slice 5.4). Owner and persona scope are checked. Texts are rendered with
 * names (title, synopsis, the finished text, each prompt and option), so a
 * client shows them as they are; mobile plays and reads Stories through this.
 * Response: `{ ok: true, data: { story: StoryView, turns: StoryTurnReadView[] } }`.
 */
export const GET = withRoute<'user', undefined, { storyId: string }>(
  { auth: 'user', name: 'stories.get' },
  async ({ user, params }) => getStoryWithTurns(await getCreationReadDb(), user, params.storyId)
);
