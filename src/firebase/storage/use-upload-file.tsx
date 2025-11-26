
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

    const uploadFile = async (path: string, dataUrl: string): Promise<string | null> => {
        if (!storage || !user) {
            const err = new Error('User or storage not available');
            setError(err);
            throw err;
        }

        setIsUploading(true);
        setError(null);
        
        const storageRef = ref(storage, path);
        
        try {
            const snapshot = await uploadString(storageRef, dataUrl, 'data_url');
            setIsUploading(false);
            const downloadURL = await getDownloadURL(snapshot.ref);
            return downloadURL;
        } catch (err: any) {
            setIsUploading(false);
            setError(err);

            const permissionError = new FirestorePermissionError({
                path: path,
                operation: 'create',
                requestResourceData: { name: storageRef.name, fullPath: storageRef.fullPath, bucket: storageRef.bucket }
            });
            errorEmitter.emit('permission-error', permissionError);
            
            // Return null or throw to indicate failure
            return null;
        }
    };

    return { uploadFile, isUploading, error };
}
