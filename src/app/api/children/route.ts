import { z } from 'zod';
import { createPerson, getPeopleDeps, legacyChildrenResponse, listPeople } from '@/server/characters';
import { editableChildSchema } from '@/server/data/schemas/people';
import { ok, withRoute } from '@/server/http';

const Body = editableChildSchema.partial().extend({ displayName: z.string().trim().min(1).max(60), idempotencyKey: z.string().min(8).max(128) });

/**
 * GET /api/children — the caller's children, not deleted. Answers the bare array the
 * mobile app reads (stored fields plus a normalised `likeness`), as before 5.7.
 * With `?view=person` (the web pages): `{ ok: true, data: PersonView[] }`.
 */
export const GET = withRoute({ auth: 'user', name: 'children.list' }, async ({ user, request }) => {
  const deps = await getPeopleDeps();
  if (new URL(request.url).searchParams.get('view') === 'person') return listPeople(deps.db, user, 'child');
  return legacyChildrenResponse(deps.db, user);
});

/**
 * POST /api/children — add a child. With no photos yet an "imagined" avatar is drawn from
 * the description (`likeness.avatar`). Same `idempotencyKey` → same child.
 * Response 201: `{ ok: true, data: PersonView }`.
 */
export const POST = withRoute({ auth: 'user', body: Body, name: 'children.create' }, async ({ user, body }) =>
  ok(await createPerson(await getPeopleDeps(), user, 'child', body), 201)
);
