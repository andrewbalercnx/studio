import { z } from 'zod';
import { childInputSchema } from '@/server/data';
import { getCreationServiceDeps, submitTurn } from '@/server/creation';
import { ok, withRoute } from '@/server/http';

const Body = z.object({
  input: childInputSchema,
  // Required: one key per child action; a repeat returns the same reply.
  idempotencyKey: z.string().min(8).max(128),
});

/**
 * POST /api/stories/{storyId}/turns — the child's input to a Story that is
 * `creating` (slice 5.3). Owner and persona scope are checked; the mode's
 * reply is recorded with the input as two turns. On `done` the Story gets its
 * text, moves to `finishing` and `story.finish` is enqueued. 409 TURN_CONFLICT
 * when another turn is being processed, TURN_IN_PROGRESS when this key is.
 */
export const POST = withRoute<'user', typeof Body, { storyId: string }>(
  { auth: 'user', body: Body, name: 'stories.turns' },
  async ({ user, params, body }) => {
    const result = await submitTurn(await getCreationServiceDeps(), user, params.storyId, body);
    return ok(result, result.created ? 201 : 200);
  }
);
