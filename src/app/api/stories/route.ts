import { z } from 'zod';
import { creationModeIdSchema } from '@/server/data';
import { createStory, getCreationReadDb, getCreationServiceDeps, listStoriesForChild } from '@/server/creation';
import { ok, withRoute } from '@/server/http';

const CreateStoryBody = z.object({
  childId: z.string().min(1).max(128),
  modeId: creationModeIdSchema,
  castIds: z.array(z.string().min(1).max(128)).max(12).optional(),
  /** adventure only: skip the story-type question. */
  storyTypeId: z.string().min(1).max(128).optional(),
  // Required: a double tap must not start two Stories.
  idempotencyKey: z.string().min(8).max(128),
});

/**
 * POST /api/stories — start creating a Story (slice 5.3, creation.md). Checks
 * the child is the caller's (persona scope applies), the mode is live (and
 * enabled for kids under a child persona), and the story allowance is
 * available (402 ENTITLEMENT_LIMIT; consumed later by `story.finish`). Records
 * the mode's first turn and returns it. A repeat with the same
 * `idempotencyKey` returns the same Story and turn (200 instead of 201).
 */
export const POST = withRoute({ auth: 'user', body: CreateStoryBody, name: 'stories.create' }, async ({ user, body }) => {
  const result = await createStory(await getCreationServiceDeps(), user, body);
  return ok(result, result.created ? 201 : 200);
});

/**
 * GET /api/stories?childId=… — the child's Stories (slice 5.4), newest first,
 * abandoned ones left out. The child must be the caller's (persona scope
 * applies). Every text is rendered with names; `status` is the server's.
 * Response: `{ ok: true, data: { stories: StoryView[] } }`.
 */
export const GET = withRoute({ auth: 'user', name: 'stories.list' }, async ({ user, request }) => {
  const childId = new URL(request.url).searchParams.get('childId') ?? '';
  return { stories: await listStoriesForChild(await getCreationReadDb(), user, childId) };
});
