'use server';

import type {Bucket, File} from '@google-cloud/storage';
import {getStorage} from 'firebase-admin/storage';
import {initFirebaseAdminApp} from './app';

let cachedBucket: Bucket | null = null;

export async function getStoryBucket(): Promise<Bucket> {
  if (cachedBucket) {
    return cachedBucket;
  }
  const app = await initFirebaseAdminApp();
  cachedBucket = getStorage(app).bucket();
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
