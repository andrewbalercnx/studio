
'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import type { FirestorePermissionError } from '@/firebase/errors';

// This component listens for custom permission errors and throws them,
// which allows Next.js's development error overlay to catch and display them.
export function FirebaseErrorListener() {
  useEffect(() => {
    const handler = (error: FirestorePermissionError) => {
      // Throw the error so the Next.js overlay can display it.
      // In a production environment, you would log this to a service like Sentry.
      if (process.env.NODE_ENV === 'development') {
        throw error;
      } else {
        console.error("Firestore Permission Error:", error.message);
      }
    };

    errorEmitter.on('permission-error', handler);

    return () => {
      errorEmitter.off('permission-error', handler);
    };
  }, []);

  return null; // This component does not render anything.
}
