import { getDb } from '@/server/data/db';
import { buildTrace } from '@/server/diagnostics/trace';
import { BadRequestError } from '@/server/errors';
import { withRoute } from '@/server/http';

/**
 * GET /api/admin/trace?bookId=bk_… | ?storyId=st_… — one Book's or Story's run
 * as a timeline: jobs (wait, run time, attempts, errors) and every AI call
 * (model, latency, tokens, prompt, response), with totals. Admin only.
 * Response: `{ ok: true, data: Trace }` (src/server/diagnostics/trace.ts).
 */
export const GET = withRoute({ auth: 'admin', name: 'admin.trace' }, async ({ request }) => {
  const url = new URL(request.url);
  const bookId = url.searchParams.get('bookId')?.trim() || undefined;
  const storyId = url.searchParams.get('storyId')?.trim() || undefined;
  if (!bookId && !storyId) throw new BadRequestError('Pass bookId or storyId', { code: 'TRACE_ID_REQUIRED' });
  return buildTrace(await getDb(), { bookId, storyId });
});
