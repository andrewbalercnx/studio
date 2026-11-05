import { getPeopleDeps, removePhoto } from '@/server/characters';
import { withRoute } from '@/server/http';

/** DELETE /api/characters/{characterId}/photos/{photoId} — remove a photo and its file; the likeness is redone from the rest. */
export const DELETE = withRoute<'user', undefined, { characterId: string; photoId: string }>({ auth: 'user', name: 'characters.photos.remove' }, async ({ user, params }) =>
  removePhoto(await getPeopleDeps(), user, 'character', params.characterId, params.photoId)
);
