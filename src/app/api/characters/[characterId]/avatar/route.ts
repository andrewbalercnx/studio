import { z } from 'zod';
import { getPeopleDeps, setAvatar } from '@/server/characters';
import { withRoute } from '@/server/http';

const Body = z.object({ source: z.enum(['portrait', 'description', 'photo']), photoId: z.string().min(1).optional() });

/**
 * POST /api/characters/{characterId}/avatar — a new avatar (UI only): drawn from the portrait, drawn from the
 * description ("imagined"), or one of the photos as it is (`photoId`).
 */
export const POST = withRoute<'user', typeof Body, { characterId: string }>({ auth: 'user', body: Body, name: 'characters.avatar' }, async ({ user, body, params }) =>
  setAvatar(await getPeopleDeps(), user, 'character', params.characterId, body)
);
