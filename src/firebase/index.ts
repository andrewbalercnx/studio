import {initializeApp, getApp, getApps, FirebaseApp} from 'firebase/app';
import {getFirestore, Firestore} from 'firebase/firestore';
import {getAuth, Auth} from 'firebase/auth';
import {firebaseConfig} from './config';

export * from './provider';

// Initializes and returns a Firebase object.
// This function can be used to interact with Firebase services.
export function initializeFirebase(): {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
} {
  const firebaseApp = !getApps().length
    ? initializeApp(firebaseConfig)
    : getApp();
  const firestore = getFirestore(firebaseApp);
  const auth = getAuth(firebaseApp);
  return {firebaseApp, firestore, auth};
}
