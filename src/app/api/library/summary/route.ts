import { getDb } from '@/server/data/db';
import { withRoute } from '@/server/http';
import { librarySummary } from '@/server/library/summary';

/**
 * GET /api/library/summary — the caller's Story and Book counts, in total and
 * per child, as the lists show them. For count badges that link to those lists.
 * Response: `{ ok: true, data: { totals: {stories, books}, byChild: {[childId]: {stories, books}} } }`.
 */
export const GET = withRoute({ auth: 'user', name: 'library.summary' }, async ({ user }) => librarySummary(await getDb(), user.uid));
