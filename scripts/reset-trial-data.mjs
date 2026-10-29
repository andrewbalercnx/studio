#!/usr/bin/env node
/**
 * Reset trial user data (docs/architecture/REVIEW_PLAN.md: trial data is not
 * migrated). Ships with slice 5.4, when the clients create Stories through the
 * new routes; see docs/DEPLOYMENT.md §10.
 *
 *   node scripts/reset-trial-data.mjs                                   # DRY RUN: counts only
 *   node scripts/reset-trial-data.mjs --confirm --project <projectId>   # delete
 *
 * Flags:
 *   --confirm               actually delete (otherwise nothing is written)
 *   --project <id>          required with --confirm; must equal the project the credentials resolve to
 *   --export-dir <dir>      where scripts/export-config.mjs wrote its output (default seed/config)
 *   --skip-export-check     run even though no config export is found there
 *   --reset-allowances      also delete entitlementLedgers (kept by default: purchases and grants survive)
 *   --include-orders        also delete printOrders (kept by default: order records tied to Mixam)
 *   --storage               also delete the Storage prefixes of every deleted story, book, manuscript
 *                           and print storybook (bucket from --bucket or FIREBASE_STORAGE_BUCKET)
 *   --bucket <name>         Storage bucket for --storage
 *
 * Deleted, with every subcollection: storySessions, children/{id}/sessions,
 * stories (turns, legacy storybooks, outputs, shareTokens…), storyBooks,
 * printStoryBooks, manuscripts, books, jobs, shareLinks (+ the flags above).
 * Kept: users, children, characters, every config collection, aiFlowLogs,
 * aiRunTraces, devTodos, tickets, feedback, and anything not listed.
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_KEY (JSON), GOOGLE_APPLICATION_CREDENTIALS,
 * or the emulator via FIRESTORE_EMULATOR_HOST (+ GCLOUD_PROJECT).
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/** Top-level collections of trial user data, deleted with all their subcollections. */
export const DELETE_COLLECTIONS = [
  'storySessions',
  'stories',
  'storyBooks',
  'printStoryBooks',
  'manuscripts',
  'books',
  'jobs',
  'shareLinks',
];
/** Deleted only with a flag. */
export const OPTIONAL_COLLECTIONS = { entitlementLedgers: 'resetAllowances', printOrders: 'includeOrders' };
/** Never touched (documented for the summary). */
export const KEPT_COLLECTIONS = [
  'users', 'children', 'characters', 'aiFlowLogs', 'aiRunTraces', 'devTodos', 'tickets', 'feedback',
  'systemConfig', 'config', 'promptConfigs', 'storyTypes', 'storyGenerators', 'storyOutputTypes', 'imageStyles',
  'answerAnimations', 'helpWizards', 'emailTemplates', 'printProducts', 'printLayouts', 'products', 'prices', 'storyPhases',
];
/** Storage prefixes owned by a deleted document. */
const STORAGE_PREFIXES = {
  stories: (id) => [`stories/${id}/`, `storybook_printables/${id}/`],
  books: (id) => [`books/${id}/`],
  manuscripts: (id) => [`manuscripts/${id}/`],
  printStoryBooks: (id) => [`print_storybooks/${id}/`],
};

const BATCH_SIZE = 400;
const PAGE_SIZE = 500;

export function parseArgs(argv) {
  const args = {
    confirm: false, project: null, exportDir: 'seed/config', skipExportCheck: false,
    resetAllowances: false, includeOrders: false, storage: false, bucket: process.env.FIREBASE_STORAGE_BUCKET ?? null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm') args.confirm = true;
    else if (arg === '--project') args.project = argv[++i];
    else if (arg === '--export-dir') args.exportDir = argv[++i];
    else if (arg === '--skip-export-check') args.skipExportCheck = true;
    else if (arg === '--reset-allowances') args.resetAllowances = true;
    else if (arg === '--include-orders') args.includeOrders = true;
    else if (arg === '--storage') args.storage = true;
    else if (arg === '--bucket') args.bucket = argv[++i];
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

function resolvedProject(app) {
  return app.options.projectId ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry with exponential backoff (contention, quota, transient errors). */
async function withBackoff(label, fn, attempts = 6) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) throw error;
      const delay = Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      console.warn(`[reset] ${label} failed (attempt ${attempt}): ${error.message ?? error}; retrying in ${delay} ms`);
      await sleep(delay);
    }
  }
}

/** Every document of a collection, page by page. */
async function* pages(collectionRef) {
  let last = null;
  for (;;) {
    let query = collectionRef.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const snapshot = await withBackoff(`read ${collectionRef.path}`, () => query.get());
    if (snapshot.empty) return;
    yield snapshot.docs.map((d) => d.ref);
    last = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) return;
  }
}

/** A document and everything below it, children before parents (so a crash never orphans data unreachable from the top). */
async function subtree(docRef, out) {
  const subcollections = await withBackoff(`list ${docRef.path}`, () => docRef.listCollections());
  for (const sub of subcollections) {
    for await (const refs of pages(sub)) {
      for (const ref of refs) await subtree(ref, out);
    }
  }
  out.push(docRef);
  return out;
}

async function deleteRefs(db, refs) {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const chunk = refs.slice(i, i + BATCH_SIZE);
    await withBackoff(`delete batch of ${chunk.length}`, async () => {
      const batch = db.batch();
      for (const ref of chunk) batch.delete(ref);
      await batch.commit();
    });
  }
}

/** Process one top-level collection: count (and delete) each document's subtree. */
async function processCollection(db, name, { confirm, storagePrefixes }) {
  const summary = { collection: name, documents: 0, withSubcollections: 0 };
  for await (const refs of pages(db.collection(name))) {
    for (const ref of refs) {
      const tree = await subtree(ref, []);
      summary.documents += 1;
      summary.withSubcollections += tree.length;
      if (STORAGE_PREFIXES[name]) storagePrefixes.push(...STORAGE_PREFIXES[name](ref.id));
      if (confirm) await deleteRefs(db, tree);
    }
  }
  return summary;
}

/** children/{childId}/sessions (the legacy session mirror); the children themselves are kept. */
async function processChildSessions(db, { confirm }) {
  const summary = { collection: 'children/*/sessions', documents: 0, withSubcollections: 0 };
  for await (const children of pages(db.collection('children'))) {
    for (const child of children) {
      for await (const refs of pages(child.collection('sessions'))) {
        for (const ref of refs) {
          const tree = await subtree(ref, []);
          summary.documents += 1;
          summary.withSubcollections += tree.length;
          if (confirm) await deleteRefs(db, tree);
        }
      }
    }
  }
  return summary;
}

async function deleteStorage(bucketName, prefixes) {
  const bucket = getStorage().bucket(bucketName);
  let files = 0;
  for (const prefix of prefixes) {
    const [found] = await withBackoff(`list gs://${bucketName}/${prefix}`, () => bucket.getFiles({ prefix }));
    for (const file of found) {
      await withBackoff(`delete ${file.name}`, () => file.delete({ ignoreNotFound: true }));
      files += 1;
    }
  }
  return files;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const manifest = join(args.exportDir, '_manifest.json');
  if (!args.skipExportCheck && !existsSync(manifest)) {
    console.error(`[reset] No config export at ${manifest}. Run scripts/export-config.mjs first, or pass --skip-export-check.`);
    return 2;
  }
  const app = initAdmin();
  const project = resolvedProject(app);
  if (args.confirm) {
    if (!args.project) {
      console.error('[reset] --confirm needs --project <projectId> (the project you mean to reset).');
      return 2;
    }
    if (args.project !== project) {
      console.error(`[reset] --project ${args.project} does not match the credentials' project (${project ?? 'unknown'}). Nothing deleted.`);
      return 2;
    }
    if (args.storage && !args.bucket) {
      console.error('[reset] --storage needs --bucket <name> or FIREBASE_STORAGE_BUCKET.');
      return 2;
    }
  }

  const db = getFirestore(app);
  const collections = [...DELETE_COLLECTIONS];
  for (const [name, flag] of Object.entries(OPTIONAL_COLLECTIONS)) if (args[flag]) collections.push(name);
  const kept = [...KEPT_COLLECTIONS, ...Object.entries(OPTIONAL_COLLECTIONS).filter(([, flag]) => !args[flag]).map(([name]) => name)];

  console.log(`[reset] ${args.confirm ? 'DELETING' : 'DRY RUN (nothing is deleted)'} in project ${project ?? 'unknown'}${process.env.FIRESTORE_EMULATOR_HOST ? ` (emulator ${process.env.FIRESTORE_EMULATOR_HOST})` : ''}`);
  const storagePrefixes = [];
  const results = [];
  for (const name of collections) results.push(await processCollection(db, name, { confirm: args.confirm, storagePrefixes }));
  results.push(await processChildSessions(db, { confirm: args.confirm }));

  for (const r of results) {
    console.log(`[reset]   ${r.collection.padEnd(22)} ${String(r.documents).padStart(6)} documents (${r.withSubcollections} with subcollections)`);
  }
  const total = results.reduce((sum, r) => sum + r.withSubcollections, 0);
  let storageFiles = null;
  if (args.storage) {
    if (args.confirm) storageFiles = await deleteStorage(args.bucket, storagePrefixes);
    console.log(`[reset]   Storage: ${storagePrefixes.length} prefixes${storageFiles !== null ? `, ${storageFiles} files deleted` : ' (dry run)'}`);
  }
  console.log(`[reset] ${args.confirm ? 'Deleted' : 'Would delete'} ${total} documents. Kept: ${kept.join(', ')}.`);
  return 0;
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('[reset] Failed:', error);
      process.exit(1);
    });
}
