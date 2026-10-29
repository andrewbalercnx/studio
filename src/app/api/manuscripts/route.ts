import { z } from 'zod';
import { createManuscript, getBookServiceDeps } from '@/server/books';
import { ok, withRoute } from '@/server/http';

const Body = z.object({
  storyId: z.string().min(1),
  formId: z.string().min(1),
  length: z.number().int().positive().optional(),
  density: z.string().min(1).optional(),
});

/**
 * POST /api/manuscripts — the words of a Story in a Form, split into pages.
 *
 * Owner of the story only (persona scope applies). Length and density default
 * from the Form and are validated against it. Idempotent per (story, form,
 * length, density): repeating the request returns the same Manuscript (201 when
 * created, 200 when it already existed; a failed one is paginated again).
 */
export const POST = withRoute({ auth: 'user', body: Body, name: 'manuscripts.create' }, async ({ user, body }) => {
  const result = await createManuscript(await getBookServiceDeps(), user, body);
  return ok(result, result.created ? 201 : 200);
});
