import { getCreationReadDb, listStoriesForOwner } from '@/server/creation';
import { withRoute } from '@/server/http';

/**
 * GET /api/admin/stories?ownerUid= — one family's Stories (`StoryView[]`,
 * every child), newest first, abandoned ones left out (admin only). Built
 * with the same views as `GET /api/stories`.
 * Response: `{ ok: true, data: { stories: StoryView[] } }`.
 */
export const GET = withRoute({ auth: 'admin', name: 'admin.stories.list' }, async ({ request }) => {
  const ownerUid = new URL(request.url).searchParams.get('ownerUid')?.trim() ?? '';
  return { stories: await listStoriesForOwner(await getCreationReadDb(), ownerUid) };
});
