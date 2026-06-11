#!/usr/bin/env node
/**
 * Serve the E2E build (standalone output) against the Firebase emulators with
 * the TEST_MODE AI seam active. Started by playwright.config.ts's webServer
 * (locally) or directly by the CI workflow.
 *
 * Safety properties:
 *  - Refuses to serve a build that was not produced by scripts/build-e2e.mjs
 *    (the marker guard) — a prod-config client bundle would send the funnel
 *    spec's writes to production Firebase.
 *  - Scrubs every credential-bearing env var so the Admin SDK can only ever
 *    talk to the emulators, under the offline `demo-` project id.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standaloneDir = join(root, '.next', 'standalone');
const markerPath = join(root, '.next', 'E2E_BUILD.json');

if (!existsSync(join(standaloneDir, 'server.js'))) {
  console.error('[start-e2e-server] No standalone build found. Run: npm run build:e2e');
  process.exit(1);
}
if (!existsSync(markerPath)) {
  console.error(
    '[start-e2e-server] .next was not built by build:e2e (marker missing). ' +
      'Refusing to run the E2E suite against a prod-config client bundle. Run: npm run build:e2e',
  );
  process.exit(1);
}

const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
const PROJECT_ID = marker.projectId || 'demo-storypic-e2e';
const PORT = process.env.E2E_APP_PORT || '9002';
const EMULATOR_HOST = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
const AUTH_PORT = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT || '9099';
const FIRESTORE_PORT = process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT || '8080';
const STORAGE_PORT = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_PORT || '9199';

// `next build` with output:'standalone' does not copy static assets into the
// standalone tree (the Dockerfile does this for prod); mirror that here.
cpSync(join(root, 'public'), join(standaloneDir, 'public'), { recursive: true });
cpSync(join(root, '.next', 'static'), join(standaloneDir, '.next', 'static'), {
  recursive: true,
});

const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT,
  HOSTNAME: '127.0.0.1',

  // The TEST_MODE AI seam: deterministic fixtures, zero model calls.
  TEST_MODE: '1',

  // Admin SDK + client SDK emulator targeting (server side).
  FIRESTORE_EMULATOR_HOST: `${EMULATOR_HOST}:${FIRESTORE_PORT}`,
  FIREBASE_AUTH_EMULATOR_HOST: `${EMULATOR_HOST}:${AUTH_PORT}`,
  FIREBASE_STORAGE_EMULATOR_HOST: `${EMULATOR_HOST}:${STORAGE_PORT}`,
  GCLOUD_PROJECT: PROJECT_ID,
  FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_USE_EMULATOR: 'true',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,

  // Make initFirebaseAdminApp's local-file branch a guaranteed miss.
  FIREBASE_SERVICE_ACCOUNT_FILE: join(root, '.nonexistent-e2e-service-account.json'),
};

// Scrub anything that could hand the server real credentials or a real project.
delete env.FIREBASE_SERVICE_ACCOUNT_KEY;
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.GOOGLE_CLOUD_PROJECT;
delete env.GCP_PROJECT_ID;

console.log(
  `[start-e2e-server] Serving E2E build on :${PORT} (project ${PROJECT_ID}, TEST_MODE on, emulators ${EMULATOR_HOST})`,
);
const child = spawn('node', ['server.js'], { cwd: standaloneDir, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
