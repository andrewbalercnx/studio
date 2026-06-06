
// This file is intentionally left blank.
// It will be populated with your Firebase project's configuration
// when you connect to a Firebase project.
import type {FirebaseOptions} from 'firebase/app';

// Production defaults. These are the values used in all normal (no-env) runs.
const DEFAULT_PROJECT_ID = 'studio-6508342045-13669';

// Allow the projectId to be overridden by an env var so the same client can
// target the Firebase Emulator Suite (or a staging project) without code edits.
// When the env var is absent, behaviour is identical to before (prod).
const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;

export const firebaseConfig: FirebaseOptions = {
  projectId,
  appId: '1:682539229514:web:7eab256bcc4712952c21b3',
  apiKey: 'AIzaSyBnmgkx6nfE8hgOqdcgeErOs0SzXVAnXmI',
  authDomain: `${projectId}.firebaseapp.com`,
  measurementId: '',
  messagingSenderId: '682539229514',
  storageBucket: `${projectId}.firebasestorage.app`,
};
