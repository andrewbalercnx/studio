import { z } from 'zod';
import { getDb } from '@/server/data/db';
import { catalogCollection, deleteCatalogDoc, setCatalogDoc, updateCatalogDoc } from '@/server/catalog/writes';
import { withRoute } from '@/server/http';

type Params = { collection: string; id: string };
const Data = z.record(z.string(), z.unknown());
const SetBody = z.object({ data: Data, merge: z.boolean().optional() });
const PatchBody = z.object({ data: Data });

/** PUT /api/admin/catalog/{collection}/{id} — replace a configuration document, or merge (`merge: true`). */
export const PUT = withRoute<'user', typeof SetBody, Params>({ auth: 'user', body: SetBody, name: 'admin.catalog.set' }, async ({ user, body, params }) =>
  setCatalogDoc({ db: await getDb() }, user, catalogCollection(params.collection), params.id, body)
);

/** PATCH /api/admin/catalog/{collection}/{id} — change fields of an existing document (dotted paths allowed). */
export const PATCH = withRoute<'user', typeof PatchBody, Params>({ auth: 'user', body: PatchBody, name: 'admin.catalog.update' }, async ({ user, body, params }) =>
  updateCatalogDoc({ db: await getDb() }, user, catalogCollection(params.collection), params.id, body)
);

/** DELETE /api/admin/catalog/{collection}/{id}. */
export const DELETE = withRoute<'user', undefined, Params>({ auth: 'user', name: 'admin.catalog.delete' }, async ({ user, params }) =>
  deleteCatalogDoc({ db: await getDb() }, user, catalogCollection(params.collection), params.id)
);
