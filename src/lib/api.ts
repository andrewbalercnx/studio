'use client';

/**
 * The web app's and kids PWA's instance of `@storypic/api-client` (Phase 6.1):
 * the same calls and types the mobile app uses, with the signed-in user's
 * Firebase ID token. Same-origin, so the persona cookie travels too.
 */
import { getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { createStoryPicClient } from '@storypic/api-client';

export * from '@storypic/api-client';

export const api = createStoryPicClient({
  baseUrl: '/api',
  getToken: async () => {
    const user = getApps().length > 0 ? getAuth().currentUser : null;
    return user ? user.getIdToken() : null;
  },
});

/** Read a picked file as a data URL for `api.people.addPhoto`. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
