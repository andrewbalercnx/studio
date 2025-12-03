'use server';

import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { initFirebaseAdminApp } from '@/firebase/admin/app';

let cachedFirestore: Firestore | null = null;

export async function getServerFirestore(): Promise<Firestore> {
  if (cachedFirestore) {
    return cachedFirestore;
  }
  const app = await initFirebaseAdminApp();
  cachedFirestore = getFirestore(app);
  return cachedFirestore;
}
