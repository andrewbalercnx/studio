import { getPeopleDeps, refreshLikeness } from '@/server/characters';
import { withRoute } from '@/server/http';

/** POST /api/characters/{characterId}/likeness/refresh — run the appearance and portrait again from the current photos. */
export const POST = withRoute<'user', undefined, { characterId: string }>({ auth: 'user', name: 'characters.likeness.refresh' }, async ({ user, params }) =>
  refreshLikeness(await getPeopleDeps(), user, 'character', params.characterId)
);
