'use server';

import { initializeApp, getApp, getApps, App, AppOptions } from 'firebase-admin/app';
import { ServiceAccount, credential } from 'firebase-admin';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firebaseConfig } from '@/firebase/config';

let adminApp: App;

function getStorageBucketOption(): Pick<AppOptions, 'storageBucket'> | Record<string, never> {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket;
  return bucket ? { storageBucket: bucket } : {};
}

export async function initFirebaseAdminApp() {
  if (getApps().length) {
    adminApp = getApp();
    console.log('[firebase-admin] Already initialized, returning existing app, options:', JSON.stringify(adminApp.options));
    return adminApp;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.log('[firebase-admin] Initializing with FIREBASE_SERVICE_ACCOUNT_KEY env var');
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as ServiceAccount;
    console.log('[firebase-admin] Service account project_id:', (serviceAccount as any).project_id);
    adminApp = initializeApp({
      credential: credential.cert(serviceAccount),
      ...getStorageBucketOption(),
    });
    return adminApp;
  }

  const localPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? join(process.cwd(), 'serviceAccount.json');
  if (existsSync(localPath)) {
    console.log('[firebase-admin] Initializing with local service account file:', localPath);
    const contents = readFileSync(localPath, 'utf-8');
    const serviceAccount = JSON.parse(contents) as ServiceAccount;
    adminApp = initializeApp({
      credential: credential.cert(serviceAccount),
      ...getStorageBucketOption(),
    });
    return adminApp;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('[firebase-admin] Initializing with GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
    adminApp = initializeApp({
      credential: credential.applicationDefault(),
      ...getStorageBucketOption(),
    });
    return adminApp;
  }

  console.log('[firebase-admin] Initializing with application default credentials');
  adminApp = initializeApp({
    credential: credential.applicationDefault(),
    projectId: firebaseConfig.projectId,
    ...getStorageBucketOption(),
  });
  return adminApp;
}
