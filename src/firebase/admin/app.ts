'use server';

import { initializeApp, getApp, getApps, App } from 'firebase-admin/app';
import { ServiceAccount, credential } from 'firebase-admin';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let adminApp: App;

export async function initFirebaseAdminApp() {
  if (getApps().length) {
    adminApp = getApp();
    return adminApp;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY) as ServiceAccount;
    adminApp = initializeApp({
      credential: credential.cert(serviceAccount)
    });
    return adminApp;
  }

  const localPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? join(process.cwd(), 'serviceAccount.json');
  if (existsSync(localPath)) {
    const contents = readFileSync(localPath, 'utf-8');
    const serviceAccount = JSON.parse(contents) as ServiceAccount;
    adminApp = initializeApp({
      credential: credential.cert(serviceAccount),
    });
    return adminApp;
  }
  
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    adminApp = initializeApp({
      credential: credential.applicationDefault()
    });
    return adminApp;
  }

  adminApp = initializeApp();
  return adminApp;
}
