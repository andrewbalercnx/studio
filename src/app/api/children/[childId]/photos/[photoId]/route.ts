import { getPeopleDeps, removePhoto } from '@/server/characters';
import { withRoute } from '@/server/http';

/** DELETE /api/children/{childId}/photos/{photoId} — remove a photo and its file; the likeness is redone from the rest. */
export const DELETE = withRoute<'user', undefined, { childId: string; photoId: string }>({ auth: 'user', name: 'children.photos.remove' }, async ({ user, params }) =>
  removePhoto(await getPeopleDeps(), user, 'child', params.childId, params.photoId)
);
