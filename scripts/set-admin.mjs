#!/usr/bin/env node
/**
 * Grant or revoke the admin / writer role for a user.
 *
 *   node scripts/set-admin.mjs <email|uid> [--writer] [--revoke]
 *
 * Roles are Firebase custom claims — the single source of truth the server
 * (src/server/http/auth.ts), the security rules (firestore.rules) and the
 * client (src/hooks/use-admin-status.tsx) all read. A `users/{uid}` doc field
 * can never confer privilege, so this script sets the CLAIM; it also mirrors
 * the role into `users/{uid}.roles` so the admin Users page shows it.
 *
 *   --writer   set the writer role instead of admin
 *   --revoke   remove the role rather than grant it
 *
 * The user must get a fresh ID token for the change to take effect: they
 * sign out and back in, or the client refreshes the token (~1 h otherwise).
 *
 * Credentials: as scripts/trace-book.mjs (application default, or
 * GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_KEY).
 */
import 'dotenv/config';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));
const role = flags.has('--writer') ? 'isWriter' : 'isAdmin';
const grant = !flags.has('--revoke');

if (!target) {
  console.error('Usage: node scripts/set-admin.mjs <email|uid> [--writer] [--revoke]');
  process.exit(2);
}

function initAdmin() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    return initializeApp({ credential: cert(key), projectId: key.project_id });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return initializeApp({ credential: applicationDefault() });
  return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT });
}

const app = initAdmin();
const auth = getAuth(app);
const db = getFirestore(app);

const user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);

const claims = { ...(user.customClaims ?? {}) };
if (grant) claims[role] = true;
else delete claims[role];
await auth.setCustomUserClaims(user.uid, claims);

// Mirror into the users doc so the admin Users page reflects the claim.
await db.doc(`users/${user.uid}`).set(
  { roles: { [role]: grant }, updatedAt: FieldValue.serverTimestamp() },
  { merge: true }
);

console.log(`${grant ? 'Granted' : 'Revoked'} ${role} for ${user.email ?? user.uid} (uid ${user.uid}).`);
console.log('Claims now:', JSON.stringify(claims));
console.log('The user must re-authenticate (sign out/in, or refresh the ID token) for this to take effect.');
process.exit(0);
