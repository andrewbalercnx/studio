import { z } from 'zod';
import { createBook, getBookServiceDeps } from '@/server/books';
import { ok, withRoute } from '@/server/http';

const Body = z
  .object({
    manuscriptId: z.string().min(1).optional(),
    storyId: z.string().min(1).optional(),
    formId: z.string().min(1).optional(),
    length: z.number().int().positive().optional(),
    density: z.string().min(1).optional(),
    styleId: z.string().min(1),
    layoutId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .refine((b) => !!b.manuscriptId || (!!b.storyId && !!b.formId), {
    message: 'Give a manuscriptId, or a storyId and formId',
  });

/**
 * POST /api/books — a Book: a Manuscript drawn in a Style (optionally with a
 * print Layout). With storyId + formId the Manuscript is created or reused with
 * the Form's defaults (the child-facing flow: the child picks Form and Style).
 * Charges one `storybook_allowance` in the creating transaction (402
 * ENTITLEMENT_LIMIT when none is left); `idempotencyKey` makes a repeat return
 * the same Book without charging again.
 */
export const POST = withRoute({ auth: 'user', body: Body, name: 'books.create' }, async ({ user, body }) => {
  const result = await createBook(await getBookServiceDeps(), user, body);
  return ok(result, result.created ? 201 : 200);
});
