import { getPeopleDeps, listPeopleOf } from '@/server/characters';
import { BadRequestError } from '@/server/errors';
import { withRoute } from '@/server/http';

/** GET /api/admin/children?ownerUid= — one family's children (`PersonView[]`, not deleted), by name (admin only). */
export const GET = withRoute({ auth: 'admin', name: 'admin.children.list' }, async ({ request }) => {
  const ownerUid = new URL(request.url).searchParams.get('ownerUid')?.trim();
  if (!ownerUid) throw new BadRequestError('ownerUid is required', { code: 'OWNER_REQUIRED' });
  return listPeopleOf((await getPeopleDeps()).db, 'child', ownerUid);
});
