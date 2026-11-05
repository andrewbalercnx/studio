import { getPeopleDeps, listPeopleOf } from '@/server/characters';
import { BadRequestError } from '@/server/errors';
import { withRoute } from '@/server/http';

/** GET /api/admin/characters?ownerUid= — one family's characters (`PersonView[]`, not deleted), by name (admin only). */
export const GET = withRoute({ auth: 'admin', name: 'admin.characters.list' }, async ({ request }) => {
  const ownerUid = new URL(request.url).searchParams.get('ownerUid')?.trim();
  if (!ownerUid) throw new BadRequestError('ownerUid is required', { code: 'OWNER_REQUIRED' });
  return listPeopleOf((await getPeopleDeps()).db, 'character', ownerUid);
});
