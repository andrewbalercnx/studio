'use server';

import type {Bucket, File} from '@google-cloud/storage';
import {getStorage} from 'firebase-admin/storage';
import {firebaseConfig} from '@/firebase/config';
import {initFirebaseAdminApp} from './app';

let cachedBucket: Bucket | null = null;
const CONFIGURED_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket;

export async function getStoryBucket(): Promise<Bucket> {
  if (cachedBucket) {
    return cachedBucket;
  }
  const app = await initFirebaseAdminApp();
  cachedBucket = CONFIGURED_BUCKET ? getStorage(app).bucket(CONFIGURED_BUCKET) : getStorage(app).bucket();
  return cachedBucket;
}

export async function deleteStorageObject(objectPath: string): Promise<boolean> {
  const bucket = await getStoryBucket();
  const file: File = bucket.file(objectPath);
  try {
    await file.delete();
    return true;
  } catch (error: any) {
    if (error?.code === 404) {
      return false;
    }
    throw error;
  }
}
