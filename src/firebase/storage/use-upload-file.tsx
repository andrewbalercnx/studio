'use client';

import {useUser} from '../auth/use-user';
import {useState} from 'react';
import {errorEmitter} from '../error-emitter';
import {FirestorePermissionError} from '../errors';

type UploadParams = {
  childId: string;
  dataUrl: string;
  fileName: string;
};

export function useUploadFile() {
  const {user} = useUser();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const uploadFile = async ({childId, dataUrl, fileName}: UploadParams): Promise<string | null> => {
    if (!user) {
      const err = new Error('You must be signed in to upload photos');
      setError(err);
      throw err;
    }

    setIsUploading(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/children/photos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({childId, dataUrl, fileName}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        const message = payload?.errorMessage ?? 'Failed to upload photo';
        const uploadError = new Error(message);
        setError(uploadError);
        const permissionError = new FirestorePermissionError({
          path: `children/${childId}/photos`,
          operation: 'create',
          requestResourceData: {fileName},
        });
        errorEmitter.emit('permission-error', permissionError);
        return null;
      }
      return payload.downloadUrl as string;
    } catch (err: any) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      setError(normalizedError);
      const permissionError = new FirestorePermissionError({
        path: `children/${childId}/photos`,
        operation: 'create',
        requestResourceData: {fileName},
      });
      errorEmitter.emit('permission-error', permissionError);
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  return {uploadFile, isUploading, error};
}
