'use client';
import {FirebaseProvider} from './provider';
import { initializeFirebase } from '.';

// Initalizes and provides the firebase app on the client.
export function FirebaseClientProvider({children}: {children: React.ReactNode}) {
  const { firebaseApp, firestore, auth, storage } = initializeFirebase();
  return <FirebaseProvider value={{firebaseApp, firestore, auth, storage}}>{children}</FirebaseProvider>;
}
