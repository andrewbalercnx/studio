/**
 * Targeted cleanup of a single probe test account and its data (POC).
 * Auth: gcloud Application Default Credentials (the committed serviceAccount.json key is rotated/dead).
 * Usage: PROBE_EMAIL=probe-poc-ezra1@example.com node tools/probe/cleanup-probe-account.mjs
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'studio-6508342045-13669';
const EMAIL = process.env.PROBE_EMAIL || 'probe-poc-ezra1@example.com';

initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

const user = await auth.getUserByEmail(EMAIL).catch(() => null);
if (!user) {
  console.log(`No auth user for ${EMAIL} — nothing to clean.`);
  process.exit(0);
}
const uid = user.uid;
console.log(`Found uid ${uid} for ${EMAIL}. Deleting their data...`);

async function deleteWhere(collection, field) {
  const snap = await db.collection(collection).where(field, '==', uid).get().catch((e) => {
    console.log(`  (skip ${collection}.${field}: ${e.message.split('\n')[0]})`);
    return { docs: [] };
  });
  for (const d of snap.docs) {
    await db.recursiveDelete(d.ref);
    console.log(`  deleted ${collection}/${d.id}`);
  }
  return snap.docs.length;
}

await deleteWhere('children', 'ownerParentUid');
await deleteWhere('storySessions', 'parentUid');
await deleteWhere('stories', 'parentUid');
await deleteWhere('stories', 'ownerParentUid');

await db.collection('users').doc(uid).delete().then(() => console.log('  deleted users/' + uid)).catch(() => {});
await auth.deleteUser(uid);
console.log(`Deleted auth user ${uid}. Cleanup complete.`);
process.exit(0);
