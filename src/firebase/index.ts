import {initializeApp, getApp, getApps, FirebaseApp} from 'firebase/app';
import {getFirestore, connectFirestoreEmulator, Firestore} from 'firebase/firestore';
import {getAuth, connectAuthEmulator, Auth} from 'firebase/auth';
import { getStorage, connectStorageEmulator, FirebaseStorage } from 'firebase/storage';
import {firebaseConfig} from './config';

export * from './provider';

// Emulator wiring is gated entirely behind this flag. With the flag unset (the
// default in every normal/prod run) none of the connectXEmulator calls fire and
// behaviour is identical to before.
const useEmulator = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true';

// Emulator hosts/ports. Overridable via env so CI can point elsewhere, but the
// defaults match the firebase.json emulators block.
const EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
const AUTH_EMULATOR_PORT =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT || '9099';
const FIRESTORE_EMULATOR_PORT =
  process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT || '8080';
const STORAGE_EMULATOR_PORT =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_PORT || '9199';

// Guard so we only connect a given service to the emulator once per process.
// connectXEmulator throws if called twice on an already-initialised service.
let emulatorsConnected = false;

function connectEmulators(auth: Auth, firestore: Firestore, storage: FirebaseStorage): void {
  if (emulatorsConnected) return;
  emulatorsConnected = true;

  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(firestore, EMULATOR_HOST, Number(FIRESTORE_EMULATOR_PORT));
  connectStorageEmulator(storage, EMULATOR_HOST, Number(STORAGE_EMULATOR_PORT));
}

// Initializes and returns a Firebase object.
// This function can be used to interact with Firebase services.
export function initializeFirebase(): {
  firebaseApp: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
} {
  const firstInit = !getApps().length;
  const firebaseApp = firstInit ? initializeApp(firebaseConfig) : getApp();
  const firestore = getFirestore(firebaseApp);
  const auth = getAuth(firebaseApp);
  const storage = getStorage(firebaseApp);

  if (useEmulator) {
    connectEmulators(auth, firestore, storage);
  }

  return {firebaseApp, firestore, auth, storage};
}
