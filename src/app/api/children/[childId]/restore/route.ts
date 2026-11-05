import { getPeopleDeps, restorePerson } from '@/server/characters';
import { withRoute } from '@/server/http';

/** POST /api/children/{childId}/restore — undo a delete. */
export const POST = withRoute<'user', undefined, { childId: string }>({ auth: 'user', name: 'children.restore' }, async ({ user, params }) =>
  restorePerson(await getPeopleDeps(), user, 'child', params.childId)
);
