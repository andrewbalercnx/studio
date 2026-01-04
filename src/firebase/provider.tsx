'use client';

import {createContext, useContext} from 'react';
import type {FirebaseApp} from 'firebase/app';
import type {Auth} from 'firebase/auth';
import type {Firestore} from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

type FirebaseContextValue = {
  firebaseApp: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
};

// Create the context
const FirebaseContext = createContext<FirebaseContextValue | null>(null);

// Create the provider component
export function FirebaseProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FirebaseContextValue;
}) {
  return (
    <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>
  );
}

// Create a hook to use the context
export function useFirebase() {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}

// Safe version that returns null instead of throwing
export function useFirebaseSafe(): FirebaseContextValue | null {
  return useContext(FirebaseContext);
}

export function useFirebaseApp() {
  return useFirebase().firebaseApp;
}
export function useAuth() {
  return useFirebase().auth;
}
export function useFirestore() {
  return useFirebase().firestore;
}
export function useStorage() {
    return useFirebase().storage;
}
