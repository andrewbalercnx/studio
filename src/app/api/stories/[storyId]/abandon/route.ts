import { abandonStory, getCreationServiceDeps } from '@/server/creation';
import { withRoute } from '@/server/http';

/**
 * POST /api/stories/{storyId}/abandon — stop creating a Story (`creating` →
 * `abandoned`). Idempotent. No allowance is charged for an abandoned Story.
 */
export const POST = withRoute<'user', undefined, { storyId: string }>(
  { auth: 'user', name: 'stories.abandon' },
  async ({ user, params }) => abandonStory(await getCreationServiceDeps(), user, params.storyId)
);
