#!/usr/bin/env node
import 'dotenv/config';
import { initializeApp, getApps, getApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const REGRESSION_FIELD = 'regressionTest';
const REGRESSION_VALUE = true;

const TARGET_COLLECTIONS = [
  { name: 'children', subcollections: ['sessions'] },
  { name: 'storySessions', subcollections: ['messages'] },
  { name: 'characters', subcollections: [] },
  { name: 'storyBooks', subcollections: ['pages', 'shareTokens'] },
  { name: 'promptConfigs', subcollections: [] },
  { name: 'printOrders', subcollections: [] },
];

function initAdmin() {
  if (getApps().length) {
    return getApp();
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return initializeApp({ credential: cert(serviceAccount) });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({ credential: applicationDefault() });
  }
  return initializeApp();
}

async function deleteSubcollection(db, collectionName, docId, subcollection) {
  const snapshot = await db.collection(`${collectionName}/${docId}/${subcollection}`).get();
  for (const doc of snapshot.docs) {
    await doc.ref.delete();
  }
}

async function cleanupCollection(db, { name, subcollections }) {
  const snapshot = await db.collection(name).where(REGRESSION_FIELD, '==', REGRESSION_VALUE).get();
  if (snapshot.empty) {
    return 0;
  }

  let deleted = 0;
  for (const docSnap of snapshot.docs) {
    const docId = docSnap.id;
    for (const sub of subcollections) {
      await deleteSubcollection(db, name, docId, sub);
    }
    await docSnap.ref.delete();
    deleted += 1;
    console.log(`[cleanup] Deleted ${name}/${docId}`);
  }
  return deleted;
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const bucket = getStorage().bucket();
  let totalDeleted = 0;

  for (const collectionConfig of TARGET_COLLECTIONS) {
    totalDeleted += await cleanupCollection(db, collectionConfig);
  }

  totalDeleted += await cleanupStorage(bucket);

  console.log(`[cleanup] Completed. Removed ${totalDeleted} regression documents.`);
  process.exit(0);
}

async function cleanupStorage(bucket) {
  let deleted = 0;
  try {
    const prefixes = ['storyBooks/', 'storybook_printables/'];
    for (const prefix of prefixes) {
      const [files] = await bucket.getFiles({ prefix });
      for (const file of files) {
        const meta = file.metadata?.metadata ?? {};
        if (meta?.regressionTest === 'true') {
          await file.delete();
          deleted += 1;
          console.log(`[cleanup] Deleted storage object ${file.name}`);
        }
      }
    }
  } catch (error) {
    console.error('[cleanup] Failed to delete storage files.', error);
  }
  return deleted;
}

main().catch((error) => {
  console.error('[cleanup] Failed to delete regression data.', error);
  process.exit(1);
});
