#!/usr/bin/env node
/**
 * Export curated configuration from Firestore to JSON, so it survives a reset
 * of trial data during the rebuild (docs/architecture/REVIEW_PLAN.md, Phase 1).
 *
 * Read-only against Firestore. Each top-level collection in CONFIG_COLLECTIONS
 * is written, with every subcollection, to <out>/<collection>.json.
 *
 *   node scripts/export-config.mjs                     # writes seed/config/
 *   node scripts/export-config.mjs --out /tmp/cfg      # another directory
 *   node scripts/export-config.mjs --dry-run           # counts only
 *   node scripts/export-config.mjs --storage-dir DIR   # also download referenced Storage files
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_KEY (JSON), GOOGLE_APPLICATION_CREDENTIALS,
 * or the emulator via FIRESTORE_EMULATOR_HOST (+ GCLOUD_PROJECT).
 *
 * Safety:
 * - Fields whose names look secret (apiKey, secret, password, token, privateKey...)
 *   are replaced with "[REDACTED]" and listed in _manifest.json, so the output
 *   can be committed. Re-enter those values by hand after a re-seed.
 * - Config documents point at files in Storage (style samples, exemplars,
 *   sound effects...). Their URLs are listed in storage-refs.json; pass
 *   --storage-dir to download the files too. Exporting documents alone
 *   leaves those URLs pointing at objects a Storage reset would delete.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * Curated, hand-maintained configuration: kept across a reset.
 * Source: docs/architecture/as-is/config-inventory.md.
 */
const CONFIG_COLLECTIONS = [
  'systemConfig',
  'promptConfigs',
  'storyTypes',
  'storyGenerators',
  'storyOutputTypes',
  'imageStyles',
  'answerAnimations',
  'helpWizards',
  'emailTemplates',
  'printProducts',
  'printLayouts',
  'products',
  'prices',
];

const SECRET_KEY = /(api[-_]?key|secret|password|passcode|token|private[-_]?key|client[-_]?secret|credential|webhook[-_]?url)/i;
const STORAGE_URL = /^(gs:\/\/|https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/)/;

function parseArgs(argv) {
  const args = { out: 'seed/config', dryRun: false, storageDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--storage-dir') args.storageDir = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function initAdmin() {
  if (getApps().length) return getApp();
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)) });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault() });
  }
  return initializeApp();
}

/**
 * Firestore values to plain JSON. Typed values become tagged objects so a
 * re-seed script can restore them; secret-looking keys are redacted.
 */
function serialize(value, path, context) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) return { __type: 'timestamp', iso: value.toDate().toISOString() };
  if (value instanceof GeoPoint) return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { __type: 'ref', path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map((item, i) => serialize(item, `${path}[${i}]`, context));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      const innerPath = path ? `${path}.${key}` : key;
      // Strings only: numeric fields such as maxOutputTokens are settings, not secrets.
      if (SECRET_KEY.test(key) && typeof inner === 'string' && inner !== '') {
        out[key] = '[REDACTED]';
        context.redactions.push({ doc: context.docPath, field: innerPath });
      } else {
        out[key] = serialize(inner, innerPath, context);
      }
    }
    return out;
  }
  if (typeof value === 'string' && STORAGE_URL.test(value)) {
    context.storageRefs.push({ doc: context.docPath, field: path, url: value });
  }
  return value;
}

async function exportDocument(docSnap, context) {
  const docContext = { ...context, docPath: docSnap.ref.path };
  const entry = { id: docSnap.id, data: serialize(docSnap.data(), '', docContext) };
  context.counts.docs += 1;
  const subcollections = await docSnap.ref.listCollections();
  if (subcollections.length > 0) {
    entry.subcollections = {};
    for (const sub of subcollections) {
      entry.subcollections[sub.id] = await exportCollection(sub, context);
    }
  }
  return entry;
}

async function exportCollection(collectionRef, context) {
  const snapshot = await collectionRef.get();
  const docs = [];
  for (const docSnap of snapshot.docs) {
    docs.push(await exportDocument(docSnap, context));
  }
  return docs;
}

/** gs://bucket/path or a Firebase/GCS download URL to { bucket, object }. */
function parseStorageUrl(url) {
  if (url.startsWith('gs://')) {
    const [bucket, ...rest] = url.slice('gs://'.length).split('/');
    return { bucket, object: rest.join('/') };
  }
  const parsed = new URL(url);
  if (parsed.hostname === 'firebasestorage.googleapis.com') {
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (match) return { bucket: match[1], object: decodeURIComponent(match[2]) };
  }
  if (parsed.hostname === 'storage.googleapis.com') {
    const [, bucket, ...rest] = parsed.pathname.split('/');
    return { bucket, object: decodeURIComponent(rest.join('/')) };
  }
  return null;
}

async function downloadStorageRefs(storageRefs, storageDir) {
  const storage = getStorage();
  const seen = new Set();
  let downloaded = 0;
  const failures = [];
  for (const ref of storageRefs) {
    const location = parseStorageUrl(ref.url);
    if (!location) {
      failures.push({ url: ref.url, error: 'unrecognised URL' });
      continue;
    }
    const key = `${location.bucket}/${location.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const destination = join(storageDir, location.bucket, location.object);
    try {
      await mkdir(dirname(destination), { recursive: true });
      await storage.bucket(location.bucket).file(location.object).download({ destination });
      downloaded += 1;
    } catch (error) {
      failures.push({ url: ref.url, error: error?.message ?? String(error) });
    }
  }
  return { downloaded, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  initAdmin();
  const db = getFirestore();

  const manifest = {
    exportedAt: new Date().toISOString(),
    project: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? null,
    emulator: process.env.FIRESTORE_EMULATOR_HOST ?? null,
    collections: {},
    redactions: [],
  };
  const allStorageRefs = [];

  if (!args.dryRun) await mkdir(args.out, { recursive: true });

  for (const name of CONFIG_COLLECTIONS) {
    const context = { counts: { docs: 0 }, redactions: [], storageRefs: [] };
    const docs = await exportCollection(db.collection(name), context);
    manifest.collections[name] = { topLevelDocs: docs.length, totalDocs: context.counts.docs };
    manifest.redactions.push(...context.redactions);
    allStorageRefs.push(...context.storageRefs);
    console.log(`[export-config] ${name}: ${docs.length} docs (${context.counts.docs} incl. subcollections)`);
    if (!args.dryRun) {
      await writeFile(join(args.out, `${name}.json`), `${JSON.stringify(docs, null, 2)}\n`);
    }
  }

  console.log(`[export-config] ${manifest.redactions.length} redacted fields, ${allStorageRefs.length} Storage references`);
  if (args.dryRun) return;

  if (args.storageDir) {
    const result = await downloadStorageRefs(allStorageRefs, args.storageDir);
    manifest.storageDownload = { dir: args.storageDir, ...result };
    console.log(`[export-config] downloaded ${result.downloaded} Storage files, ${result.failures.length} failures`);
  }

  await writeFile(join(args.out, 'storage-refs.json'), `${JSON.stringify(allStorageRefs, null, 2)}\n`);
  await writeFile(join(args.out, '_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[export-config] wrote ${args.out}`);
}

main().catch((error) => {
  console.error('[export-config] failed:', error);
  process.exit(1);
});
