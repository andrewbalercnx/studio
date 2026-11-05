import { deletePerson, getPeopleDeps, getPerson, legacyChildrenResponse, updatePerson } from '@/server/characters';
import { editableChildSchema } from '@/server/data/schemas/people';
import { withRoute } from '@/server/http';

type Params = { childId: string };
const Patch = editableChildSchema.partial();

/**
 * GET /api/children/{childId} — one child, in the shape the mobile app reads (stored fields plus `likeness`).
 * With `?view=person` (the web pages): `{ ok: true, data: PersonView }`.
 */
export const GET = withRoute<'user', undefined, Params>({ auth: 'user', name: 'children.get' }, async ({ user, params, request }) => {
  const deps = await getPeopleDeps();
  if (new URL(request.url).searchParams.get('view') === 'person') return getPerson(deps.db, user, 'child', params.childId);
  return legacyChildrenResponse(deps.db, user, params.childId);
});

/** PATCH /api/children/{childId} — edit profile fields (allowlist); likeness fields are never client-written. */
export const PATCH = withRoute<'user', typeof Patch, Params>({ auth: 'user', body: Patch, name: 'children.update' }, async ({ user, body, params }) =>
  updatePerson(await getPeopleDeps(), user, 'child', params.childId, body)
);

/** DELETE /api/children/{childId} — soft delete (undo: POST …/restore). */
export const DELETE = withRoute<'user', undefined, Params>({ auth: 'user', name: 'children.delete' }, async ({ user, params }) =>
  deletePerson(await getPeopleDeps(), user, 'child', params.childId)
);
