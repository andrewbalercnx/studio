#!/usr/bin/env node
/**
 * scripts/reset-trial-data.mjs against the Firestore emulator:
 *
 *   npm run test:reset
 *
 * Seeds one document of every kind (with subcollections), then checks the
 * guards (no export, no --project, wrong project), the dry run (counts,
 * nothing deleted), the default delete (trial data gone, users, children,
 * characters, config, logs, allowances and orders kept) and the opt-in flags.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-reset';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Run under the Firestore emulator (npm run test:reset).');
  process.exit(1);
}
const db = getFirestore(initializeApp({ projectId: PROJECT }));

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `: ${detail}`}`);
}

const DELETED = [
  'storySessions/s1', 'storySessions/s1/messages/m1',
  'children/c1/sessions/x1',
  'stories/s1', 'stories/s1/storybooks/b1', 'stories/s1/storybooks/b1/pages/p1', 'stories/s1/outputs/storybook', 'stories/s1/shareTokens/t1',
  'stories/st1', 'stories/st1/turns/0000',
  'storyBooks/sb1', 'printStoryBooks/pb1',
  'manuscripts/m1', 'manuscripts/m1/pages/1',
  'books/k1', 'books/k1/pages/1', 'books/k1/castSheets/c1', 'books/k1/renders/r1',
  'jobs/j1', 'shareLinks/x1',
];
const KEPT = [
  'users/p1', 'users/p1/addresses/a1', 'children/c1', 'characters/ch1', 'characters/chr_story',
  'systemConfig/diagnostics', 'storyGenerators/wizard', 'storyTypes/quest', 'imageStyles/w',
  'aiFlowLogs/l1', 'aiRunTraces/r1', 'devTodos/t1', 'tickets/t1', 'feedback/f1',
];
const OPTIONAL = ['entitlementLedgers/p1', 'printOrders/o1'];

async function seed() {
  for (const path of [...DELETED, ...KEPT, ...OPTIONAL]) {
    await db.doc(path).set({ seeded: true, ownerUid: 'p1' });
  }
}

async function exists(path) {
  return (await db.doc(path).get()).exists;
}

async function allExist(paths) {
  const missing = [];
  for (const path of paths) if (!(await exists(path))) missing.push(path);
  return missing;
}

async function noneExist(paths) {
  const present = [];
  for (const path of paths) if (await exists(path)) present.push(path);
  return present;
}

const exportDir = mkdtempSync(join(tmpdir(), 'reset-export-'));
writeFileSync(join(exportDir, '_manifest.json'), '{}');
const emptyDir = mkdtempSync(join(tmpdir(), 'reset-noexport-'));

function run(...args) {
  const result = spawnSync(process.execPath, ['scripts/reset-trial-data.mjs', ...args], {
    env: { ...process.env, GCLOUD_PROJECT: PROJECT, FIREBASE_SERVICE_ACCOUNT_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '' },
    encoding: 'utf8',
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

await seed();

// Guards.
let r = run('--export-dir', emptyDir);
check('refuses without a config export', r.code === 2 && r.out.includes('No config export'), r.out);
r = run('--export-dir', exportDir, '--confirm');
check('--confirm needs --project', r.code === 2 && r.out.includes('needs --project'), r.out);
r = run('--export-dir', exportDir, '--confirm', '--project', 'storypic-prod');
check('refuses a project that is not the credentials\' project', r.code === 2 && r.out.includes('does not match'), r.out);
check('guards deleted nothing', (await allExist([...DELETED, ...KEPT, ...OPTIONAL])).length === 0);

// Dry run.
r = run('--export-dir', exportDir);
check('dry run exits 0', r.code === 0, r.out);
check('dry run says so', r.out.includes('DRY RUN'), r.out);
check('dry run counts stories with subcollections', /stories\s+2 documents \(7 with subcollections\)/.test(r.out), r.out);
check('dry run counts child sessions', /children\/\*\/sessions\s+1 documents/.test(r.out), r.out);
check('dry run deletes nothing', (await allExist([...DELETED, ...KEPT, ...OPTIONAL])).length === 0);
r = run('--skip-export-check', '--export-dir', emptyDir);
check('--skip-export-check runs without an export', r.code === 0, r.out);

// Delete (defaults).
r = run('--export-dir', exportDir, '--confirm', '--project', PROJECT);
check('delete exits 0', r.code === 0, r.out);
check(`delete reports ${DELETED.length} documents`, r.out.includes(`Deleted ${DELETED.length} documents`), r.out);
let left = await noneExist(DELETED);
check('trial data and every subcollection deleted', left.length === 0, left.join(', '));
let missing = await allExist(KEPT);
check('users, children, characters, config, logs, todos, tickets, feedback kept', missing.length === 0, missing.join(', '));
missing = await allExist(OPTIONAL);
check('allowances and print orders kept by default', missing.length === 0, missing.join(', '));

// Opt-in flags.
r = run('--export-dir', exportDir, '--confirm', '--project', PROJECT, '--reset-allowances', '--include-orders');
check('flagged delete exits 0', r.code === 0, r.out);
left = await noneExist(OPTIONAL);
check('--reset-allowances and --include-orders delete ledgers and orders', left.length === 0, left.join(', '));
missing = await allExist(KEPT);
check('still keeps the rest', missing.length === 0, missing.join(', '));

console.log(failures ? `${failures} reset check(s) FAILED` : 'All reset checks passed');
process.exit(failures ? 1 : 0);
