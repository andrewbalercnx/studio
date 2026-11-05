import { z } from 'zod';
import { getPeopleDeps, reassignOwner } from '@/server/characters';
import { withRoute } from '@/server/http';

const Body = z.object({ ownerUid: z.string().min(1) });

/** PATCH /api/admin/children/{childId} — move to another family (admin only). */
export const PATCH = withRoute<'admin', typeof Body, { childId: string }>({ auth: 'admin', body: Body, name: 'admin.children.reassign' }, async ({ user, body, params }) =>
  reassignOwner(await getPeopleDeps(), user, 'child', params.childId, body.ownerUid)
);
