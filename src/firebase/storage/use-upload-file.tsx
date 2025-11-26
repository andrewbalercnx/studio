
'use client';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { useStorage } from '../provider';
import { useUser } from '../auth/use-user';
import { useState } from 'react';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

export function useUploadFile() {
    const storage = useStorage();
    const { user } = useUser();
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const uploadFile = async (path: string, dataUrl: string) => {
        if (!storage || !user) {
            const err = new Error('User or storage not available');
            setError(err);
            throw err;
        }

        setIsUploading(true);
        setError(null);
        
        const storageRef = ref(storage, path);
        
        uploadString(storageRef, dataUrl, 'data_url').then(snapshot => {
            setIsUploading(false);
            return getDownloadURL(snapshot.ref);
        }).catch(err => {
            setIsUploading(false);
            setError(err);

            // Create and emit the contextual permission error
            const permissionError = new FirestorePermissionError({
                path: path,
                operation: 'create', // upload is essentially a create operation
                requestResourceData: {
                    name: storageRef.name,
                    fullPath: storageRef.fullPath,
                    bucket: storageRef.bucket,
                    size: dataUrl.length // Approximate size
                }
            });
            errorEmitter.emit('permission-error', permissionError);
            
            // We don't re-throw here because the listener will handle it.
        });
    };

    return { uploadFile, isUploading, error };
}
