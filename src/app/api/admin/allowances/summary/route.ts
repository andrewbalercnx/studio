import { getDb } from '@/server/data/db';
import { allowanceTotals } from '@/server/entitlements/admin-allowances';
import { withRoute } from '@/server/http';

/**
 * GET /api/admin/allowances/summary — stories and books left for every family
 * (family pool plus children's own), for the admin Users list. Admin only.
 * Response: `{ ok: true, data: { byUid: {[uid]: {stories, books}}, freeTier: {stories, books} } }`.
 */
export const GET = withRoute({ auth: 'admin', name: 'admin.allowances.summary' }, async () => allowanceTotals(await getDb(), new Date()));
