import { z } from 'zod';
import { createPerson, getPeopleDeps, listPeople } from '@/server/characters';
import { editableCharacterSchema } from '@/server/data/schemas/people';
import { ok, withRoute } from '@/server/http';

const Body = editableCharacterSchema.partial().extend({ displayName: z.string().trim().min(1).max(60), idempotencyKey: z.string().min(8).max(128) });

/**
 * GET /api/characters[?childId=][&includeHelp=1] — the family's characters (not deleted), by name; with `childId`,
 * those that child may use; with `includeHelp`, the help-tour sample character is appended.
 */
export const GET = withRoute({ auth: 'user', name: 'characters.list' }, async ({ user, request }) => {
  const params = new URL(request.url).searchParams;
  const childId = params.get('childId')?.trim() || null;
  return listPeople((await getPeopleDeps()).db, user, 'character', { childId, includeHelp: params.get('includeHelp') === '1' });
});

/** POST /api/characters — add a character; an "imagined" avatar is drawn from the description until photos arrive. */
export const POST = withRoute({ auth: 'user', body: Body, name: 'characters.create' }, async ({ user, body }) =>
  ok(await createPerson(await getPeopleDeps(), user, 'character', body), 201)
);
