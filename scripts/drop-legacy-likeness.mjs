#!/usr/bin/env node
/**
 * One-off cleanup after the likeness migration (slice 6.3). Removes the old
 * field names from every child and character, now that `scripts/migrate-likeness.mjs`
 * has copied them into the target `ownerUid` + `likeness.*` shape and no client
 * reads them any more:
 *
 *   ownerParentUid, imageDescription, imageDescriptionGeneration,
 *   canonicalImageUrl, canonicalImageGeneration, avatarUrl,
 *   avatarAnimationUrl, avatarAnimationGeneration
 *
 * A document is only touched when it has been migrated (`likenessMigratedAt`
 * is stamped); one that still carries an old field but was never migrated is
 * refused (counted as blocked), so running the drop before the migration can
 * never lose data. A document already in the clean shape has nothing to drop.
 *
 *   node scripts/drop-legacy-likeness.mjs                                   # DRY RUN: counts only
 *   node scripts/drop-legacy-likeness.mjs --confirm --project <projectId>   # write
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_KEY (JSON), GOOGLE_APPLICATION_CREDENTIALS,
 * or GCLOUD_PROJECT with Application Default Credentials.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const COLLECTIONS = ['children', 'characters'];

/** The old field names dropped by this slice (migrate-likeness copied them into `likeness.*`). */
export const LEGACY_FIELDS = [
  'ownerParentUid',
  'imageDescription',
  'imageDescriptionGeneration',
  'canonicalImageUrl',
  'canonicalImageGeneration',
  'avatarUrl',
  'avatarAnimationUrl',
  'avatarAnimationGeneration',
];

/**
 * The plan for one document: which old fields it still carries, and whether it
 * is blocked (carries an old field but was never migrated). Pure, so it is
 * unit-tested.
 */
export function dropPlan(data) {
  const fields = LEGACY_FIELDS.filter((f) => data[f] !== undefined);
  if (fields.length === 0) return { fields: [], blocked: false };
  return { fields, blocked: data.likenessMigratedAt == null };
}

export function parseArgs(argv) {
  const args = { confirm: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm') args.confirm = true;
    else if (arg === '--project') args.project = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function initAdmin() {
  if (getApps().length) return getApp();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return initializeApp({ credential: cert(key), projectId: key.project_id });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return initializeApp({ credential: applicationDefault() });
  return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT });
}

export async function drop(db, { confirm }) {
  const counts = {};
  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    let toDrop = 0;
    let blocked = 0;
    let batch = db.batch();
    let pending = 0;
    for (const doc of snapshot.docs) {
      const plan = dropPlan(doc.data());
      if (plan.fields.length === 0) continue;
      if (plan.blocked) {
        blocked += 1;
        console.warn(`[drop-legacy-likeness] ${name}/${doc.id}: has old fields but no likenessMigratedAt — skipped`);
        continue;
      }
      toDrop += 1;
      if (!confirm) continue;
      batch.update(doc.ref, Object.fromEntries(plan.fields.map((f) => [f, FieldValue.delete()])));
      pending += 1;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (confirm && pending) await batch.commit();
    counts[name] = { documents: snapshot.size, toDrop, blocked };
  }
  return counts;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const app = initAdmin();
  const project = app.options.projectId ?? process.env.GCLOUD_PROJECT ?? null;
  if (args.confirm && args.project !== project) {
    console.error(`[drop-legacy-likeness] --confirm needs --project matching the credentials' project (${project ?? 'unknown'}). Nothing written.`);
    return 2;
  }
  console.log(`[drop-legacy-likeness] ${args.confirm ? 'WRITING' : 'DRY RUN (nothing is written)'} in project ${project ?? 'unknown'}`);
  const counts = await drop(getFirestore(app), { confirm: args.confirm });
  for (const [name, c] of Object.entries(counts)) {
    console.log(`[drop-legacy-likeness] ${name}: ${c.toDrop} of ${c.documents} ${args.confirm ? 'cleaned' : 'to clean'}${c.blocked ? `, ${c.blocked} blocked (not migrated)` : ''}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code), (error) => {
    console.error('[drop-legacy-likeness]', error);
    process.exit(1);
  });
}
