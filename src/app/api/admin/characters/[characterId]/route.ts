import { z } from 'zod';
import { getPeopleDeps, reassignOwner } from '@/server/characters';
import { withRoute } from '@/server/http';

const Body = z.object({ ownerUid: z.string().min(1) });

/** PATCH /api/admin/characters/{characterId} — move to another family (admin only). */
export const PATCH = withRoute<'admin', typeof Body, { characterId: string }>({ auth: 'admin', body: Body, name: 'admin.characters.reassign' }, async ({ user, body, params }) =>
  reassignOwner(await getPeopleDeps(), user, 'character', params.characterId, body.ownerUid)
);
