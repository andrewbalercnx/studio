import { getCreationServiceDeps, retryFinish } from '@/server/creation';
import { withRoute } from '@/server/http';

/**
 * POST /api/stories/{storyId}/finish — finish a Story again after `story.finish`
 * failed (`failed` → `finishing`, new job). Idempotent for `finishing` and
 * `complete` Stories (pipeline.md: "failed (retry → finishing)").
 */
export const POST = withRoute<'user', undefined, { storyId: string }>(
  { auth: 'user', name: 'stories.finish' },
  async ({ user, params }) => retryFinish(await getCreationServiceDeps(), user, params.storyId)
);
