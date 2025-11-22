'use client';
import { getDownloadURL, ref, uploadString } from 'firebase/storage';
import { useStorage } from '../provider';
import { useUser } from '../auth/use-user';
import { useState } from 'react';

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
        
        try {
            const storageRef = ref(storage, `users/${user.uid}/${path}`);
            const snapshot = await uploadString(storageRef, dataUrl, 'data_url');
            const downloadUrl = await getDownloadURL(snapshot.ref);
            return downloadUrl;
        } catch (e: any) {
            setError(e);
            throw e;
        } finally {
            setIsUploading(false);
        }
    };

    return { uploadFile, isUploading, error };
}
