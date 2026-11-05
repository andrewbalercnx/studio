#!/usr/bin/env node
/**
 * One-off likeness migration (slice 5.7, owner decision "migrate once").
 * Copies the old fields of every child and character into the target shape:
 *
 *   ownerParentUid      → ownerUid
 *   photos              → likeness.photos
 *   imageDescription    → likeness.appearance
 *   canonicalImageUrl   → likeness.portrait
 *   avatarUrl           → likeness.avatar            (placeholder / stock URLs dropped, ADR-0006)
 *   avatarAnimationUrl  → likeness.avatarAnimation
 *
 * and stamps `likenessMigratedAt`. Fields already in the target shape win, so
 * a second run changes nothing. The old fields are left in place (old pages
 * read them until 5.7b; a later release removes them).
 *
 *   node scripts/migrate-likeness.mjs                                   # DRY RUN: counts only
 *   node scripts/migrate-likeness.mjs --confirm --project <projectId>   # write
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_KEY (JSON), GOOGLE_APPLICATION_CREDENTIALS,
 * or the emulator via FIRESTORE_EMULATOR_HOST (+ GCLOUD_PROJECT).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

export const COLLECTIONS = ['children', 'characters'];

const PLACEHOLDER_IMAGE = /picsum\.photos|placehold|placeholder|dummyimage\.com|loremflickr|unsplash\.it|fakeimg/i;

function str(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function image(value) {
  const url = str(value);
  return url && !PLACEHOLDER_IMAGE.test(url) ? url : null;
}

function strings(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim().length > 0 && !PLACEHOLDER_IMAGE.test(v)) : [];
}

/**
 * The update that brings one stored document to the target shape, or null when
 * it already is. Pure, so the mapping is unit-tested.
 */
export function migrationPatch(data) {
  const target = data.likeness && typeof data.likeness === 'object' ? data.likeness : {};
  const owner = str(data.ownerUid) ?? str(data.ownerParentUid);
  const likeness = {
    photos: strings(target.photos).length ? strings(target.photos) : strings(data.photos),
    appearance: str(target.appearance) ?? str(data.imageDescription),
    portrait: image(target.portrait) ?? image(data.canonicalImageUrl),
    avatar: image(target.avatar) ?? image(data.avatarUrl),
    avatarSource: str(target.avatarSource),
    avatarAnimation: image(target.avatarAnimation) ?? image(data.avatarAnimationUrl),
    likenessJob: target.likenessJob && typeof target.likenessJob === 'object' ? target.likenessJob : {},
  };
  if (!likeness.avatar) likeness.avatarSource = null;
  const patch = {};
  if (owner && data.ownerUid !== owner) patch.ownerUid = owner;
  const same =
    data.likeness &&
    JSON.stringify(strings(target.photos)) === JSON.stringify(likeness.photos) &&
    (target.appearance ?? null) === likeness.appearance &&
    (target.portrait ?? null) === likeness.portrait &&
    (target.avatar ?? null) === likeness.avatar &&
    (target.avatarAnimation ?? null) === likeness.avatarAnimation;
  if (!same) patch.likeness = likeness;
  return Object.keys(patch).length ? patch : null;
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

export async function migrate(db, { confirm }) {
  const counts = {};
  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    let changed = 0;
    let batch = db.batch();
    let pending = 0;
    for (const doc of snapshot.docs) {
      const patch = migrationPatch(doc.data());
      if (!patch) continue;
      changed += 1;
      if (!confirm) continue;
      batch.update(doc.ref, { ...patch, likenessMigratedAt: FieldValue.serverTimestamp() });
      pending += 1;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (confirm && pending) await batch.commit();
    counts[name] = { documents: snapshot.size, toMigrate: changed };
  }
  return counts;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const app = initAdmin();
  const project = app.options.projectId ?? process.env.GCLOUD_PROJECT ?? null;
  if (args.confirm && args.project !== project) {
    console.error(`[migrate-likeness] --confirm needs --project matching the credentials' project (${project ?? 'unknown'}). Nothing written.`);
    return 2;
  }
  console.log(`[migrate-likeness] ${args.confirm ? 'WRITING' : 'DRY RUN (nothing is written)'} in project ${project ?? 'unknown'}`);
  const counts = await migrate(getFirestore(app), { confirm: args.confirm });
  for (const [name, c] of Object.entries(counts)) console.log(`[migrate-likeness] ${name}: ${c.toMigrate} of ${c.documents} ${args.confirm ? 'migrated' : 'to migrate'}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code), (error) => {
    console.error('[migrate-likeness]', error);
    process.exit(1);
  });
}
