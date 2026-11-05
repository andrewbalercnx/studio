import { z } from 'zod';
import { getDb } from '@/server/data/db';
import { catalogCollection, createCatalogDoc } from '@/server/catalog/writes';
import { ok, withRoute } from '@/server/http';

const Body = z.object({ id: z.string().min(1).optional(), data: z.record(z.string(), z.unknown()) });

/**
 * POST /api/admin/catalog/{collection} — create a configuration document (writers and admins;
 * print products and story generators admins only). `{ id?, data }` → 201 `{ id }`.
 */
export const POST = withRoute<'user', typeof Body, { collection: string }>({ auth: 'user', body: Body, name: 'admin.catalog.create' }, async ({ user, body, params }) =>
  ok(await createCatalogDoc({ db: await getDb() }, user, catalogCollection(params.collection), body), 201)
);
