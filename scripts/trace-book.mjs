#!/usr/bin/env node
/**
 * Everything the server recorded about one Book, as a timeline:
 *
 *   node scripts/trace-book.mjs <bookId>
 *
 * - the Book and its art rollup;
 * - every job for the family since the Book's story started (kind, status,
 *   attempts, queue wait, run time, error), so the chain paginate → narrate →
 *   cast sheets → page art shows where it stopped;
 * - every AI call logged in that window (aiFlowLogs: flow, model, latency,
 *   input/output/thinking tokens, status). AI calls are logged only while
 *   systemConfig/diagnostics.enableAIFlowLogging is on.
 *
 * Credentials: as scripts/reset-trial-data.mjs (application default, or
 * GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_KEY).
 */
import 'dotenv/config';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: node scripts/trace-book.mjs <bookId>');
  process.exit(2);
}

function initAdmin() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return initializeApp({ credential: cert(key), projectId: key.project_id });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return initializeApp({ credential: applicationDefault() });
  return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT });
}

const db = getFirestore(initAdmin());
const ms = (t) => (t instanceof Timestamp ? t.toMillis() : typeof t?.toMillis === 'function' ? t.toMillis() : null);
const clock = (t) => (t === null ? '        ' : new Date(t).toISOString().slice(11, 19));
const secs = (a, b) => (a === null || b === null ? '   -  ' : `${((b - a) / 1000).toFixed(1).padStart(5)}s`);

const bookSnap = await db.doc(`books/${bookId}`).get();
if (!bookSnap.exists) {
  console.error(`No book ${bookId}`);
  process.exit(1);
}
const book = bookSnap.data();
const storySnap = await db.doc(`stories/${book.storyId}`).get();
const story = storySnap.data() ?? {};
const since = Math.min(ms(book.createdAt) ?? Date.now(), ms(story.createdAt) ?? Date.now()) - 60_000;

console.log(`Book ${bookId}  status=${book.status}  art=${book.art?.done ?? 0}/${book.art?.total ?? 0} done, ${book.art?.failed ?? 0} failed`);
console.log(`  story ${book.storyId} (${story.status ?? '?'}, mode ${story.modeId ?? '?'})  manuscript ${book.manuscriptId}  style ${book.styleId}`);
console.log(`  created ${new Date(ms(book.createdAt)).toISOString()}  updated ${new Date(ms(book.updatedAt)).toISOString()}`);

const pages = await db.collection(`books/${bookId}/pages`).get();
const pageStates = {};
for (const p of pages.docs) {
  const d = p.data();
  const state = d.artUrl ? 'art' : d.artJob?.status ?? d.artStatus ?? 'none';
  pageStates[state] = (pageStates[state] ?? 0) + 1;
}
console.log(`  pages: ${pages.size} (${Object.entries(pageStates).map(([k, v]) => `${v} ${k}`).join(', ')})`);
const castSheets = await db.collection(`books/${bookId}/castSheets`).get();
console.log(`  cast sheets: ${castSheets.size} (${castSheets.docs.map((c) => `${c.id}:${c.data().status ?? (c.data().imageUrl ? 'ready' : '?')}`).join(', ')})`);

// Jobs: one owner, filtered in memory (no composite index needed).
const jobSnap = await db.collection('jobs').where('ownerUid', '==', book.ownerUid).get();
const related = new Set([bookId, book.manuscriptId, book.storyId]);
const jobs = jobSnap.docs
  .map((d) => d.data())
  .filter((j) => (ms(j.createdAt) ?? 0) >= since && (related.has(j.target?.id) || related.has(j.input?.bookId)))
  .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
console.log(`\nJobs (${jobs.length})   created   wait   run    status     att  kind / target / error`);
const byStatus = {};
for (const j of jobs) {
  byStatus[`${j.kind}:${j.status}`] = (byStatus[`${j.kind}:${j.status}`] ?? 0) + 1;
  const created = ms(j.createdAt);
  const started = ms(j.startedAt);
  const finished = ms(j.finishedAt);
  console.log(
    `  ${clock(created)} ${secs(created, started)} ${secs(started, finished)}  ${String(j.status).padEnd(10)} ${String(j.attempt).padStart(2)}/${j.maxAttempts}  ${j.kind} ${j.target?.collection}/${j.target?.id}${j.target?.subpath ? `/${j.target.subpath}` : ''}${j.error ? `  ERROR ${j.error.code}: ${String(j.error.message).slice(0, 160)}` : ''}`
  );
}
console.log('  totals:', Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  '));

// AI calls by this family in the window.
const logSnap = await db.collection('aiFlowLogs').where('createdAt', '>=', Timestamp.fromMillis(since)).get();
const calls = logSnap.docs
  .map((d) => d.data())
  .filter((l) => l.parentId === book.ownerUid)
  .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
console.log(`\nAI calls (${calls.length})  latency  in/out/think tokens   status   model  flow`);
const totals = { calls: 0, ms: 0, input: 0, output: 0, thoughts: 0 };
for (const l of calls) {
  const u = l.usage ?? {};
  totals.calls += 1;
  totals.ms += l.latencyMs ?? 0;
  totals.input += u.inputTokens ?? 0;
  totals.output += u.outputTokens ?? 0;
  totals.thoughts += u.thoughtsTokens ?? 0;
  console.log(
    `  ${clock(ms(l.createdAt))} ${String(l.latencyMs ?? '-').padStart(7)}ms  ${String(u.inputTokens ?? '-').padStart(6)}/${String(u.outputTokens ?? '-').padStart(5)}/${String(u.thoughtsTokens ?? '-').padStart(5)}  ${String(l.status).padEnd(8)} ${l.modelName ?? '?'}  ${l.flowName}${l.errorMessage ? `  ERROR ${String(l.errorMessage).slice(0, 160)}` : ''}${l.failureReason ? `  FAIL ${l.failureReason}` : ''}`
  );
}
console.log(`  totals: ${totals.calls} calls, ${(totals.ms / 1000).toFixed(1)}s model time, ${totals.input} in / ${totals.output} out / ${totals.thoughts} thinking tokens`);
if (calls.length === 0) {
  const diag = (await db.doc('systemConfig/diagnostics').get()).data() ?? {};
  console.log(`  (none logged; systemConfig/diagnostics.enableAIFlowLogging = ${diag.enableAIFlowLogging ?? 'unset'})`);
}
process.exit(0);
