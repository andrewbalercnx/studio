'use client';
import {FirebaseProvider} from './provider';
import { initializeFirebase } from '.';

// Initalizes and provides the firebase app on the client.
export function FirebaseClientProvider({children}: {children: React.ReactNode}) {
  return <FirebaseProvider {...initializeFirebase()}>{children}</FirebaseProvider>;
}
