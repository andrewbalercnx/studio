import { getPeopleDeps, refreshLikeness } from '@/server/characters';
import { withRoute } from '@/server/http';

/** POST /api/children/{childId}/likeness/refresh — run the appearance and portrait again from the current photos. */
export const POST = withRoute<'user', undefined, { childId: string }>({ auth: 'user', name: 'children.likeness.refresh' }, async ({ user, params }) =>
  refreshLikeness(await getPeopleDeps(), user, 'child', params.childId)
);
