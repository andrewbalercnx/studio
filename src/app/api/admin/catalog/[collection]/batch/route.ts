import { z } from 'zod';
import { getDb } from '@/server/data/db';
import { batchSetCatalogDocs, catalogCollection } from '@/server/catalog/writes';
import { withRoute } from '@/server/http';

const Body = z.object({
  items: z.array(z.object({ id: z.string().min(1), data: z.record(z.string(), z.unknown()) })).min(1).max(400),
  merge: z.boolean().optional(),
});

/** POST /api/admin/catalog/{collection}/batch — write many configuration documents at once (seeding defaults). */
export const POST = withRoute<'user', typeof Body, { collection: string }>({ auth: 'user', body: Body, name: 'admin.catalog.batch' }, async ({ user, body, params }) =>
  batchSetCatalogDocs({ db: await getDb() }, user, catalogCollection(params.collection), body)
);
