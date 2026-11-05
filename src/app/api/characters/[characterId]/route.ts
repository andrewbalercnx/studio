import { deletePerson, getPeopleDeps, getPerson, updatePerson } from '@/server/characters';
import { editableCharacterSchema } from '@/server/data/schemas/people';
import { withRoute } from '@/server/http';

type Params = { characterId: string };
const Patch = editableCharacterSchema.partial();

/** GET /api/characters/{characterId} — one character (`PersonView`). */
export const GET = withRoute<'user', undefined, Params>({ auth: 'user', name: 'characters.get' }, async ({ user, params }) => {
  return getPerson((await getPeopleDeps()).db, user, 'character', params.characterId);
});

/** PATCH /api/characters/{characterId} — edit profile fields (allowlist); likeness fields are never client-written. */
export const PATCH = withRoute<'user', typeof Patch, Params>({ auth: 'user', body: Patch, name: 'characters.update' }, async ({ user, body, params }) =>
  updatePerson(await getPeopleDeps(), user, 'character', params.characterId, body)
);

/** DELETE /api/characters/{characterId} — soft delete (undo: POST …/restore). */
export const DELETE = withRoute<'user', undefined, Params>({ auth: 'user', name: 'characters.delete' }, async ({ user, params }) =>
  deletePerson(await getPeopleDeps(), user, 'character', params.characterId)
);
