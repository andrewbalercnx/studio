import { z } from 'zod';
import { addPhoto, getPeopleDeps } from '@/server/characters';
import { withRoute } from '@/server/http';

const Body = z.object({ dataUrl: z.string().min(16) });

/**
 * POST /api/characters/{characterId}/photos — add an original photo (data URL, image/*, ≤ 8 MB, ≤ 10 photos).
 * Stores the file and updates `photos` in one step, then redoes the appearance and portrait (jobs).
 */
export const POST = withRoute<'user', typeof Body, { characterId: string }>({ auth: 'user', body: Body, name: 'characters.photos.add' }, async ({ user, body, params }) =>
  addPhoto(await getPeopleDeps(), user, 'character', params.characterId, body)
);
