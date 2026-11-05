import { getPeopleDeps, restorePerson } from '@/server/characters';
import { withRoute } from '@/server/http';

/** POST /api/characters/{characterId}/restore — undo a delete. */
export const POST = withRoute<'user', undefined, { characterId: string }>({ auth: 'user', name: 'characters.restore' }, async ({ user, params }) =>
  restorePerson(await getPeopleDeps(), user, 'character', params.characterId)
);
