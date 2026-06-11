#!/usr/bin/env node
/**
 * Build the Next app for the emulator-backed E2E suite.
 *
 * NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so an
 * E2E run needs its own build with the emulator flags baked in. This script
 * runs that build and stamps the output with a marker file; the companion
 * scripts/start-e2e-server.mjs refuses to serve a build without the marker.
 *
 * That guard matters: a prod-config build served to the E2E suite would point
 * the funnel spec's signup at PRODUCTION Firebase.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || 'demo-storypic-e2e';

const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_PUBLIC_FIREBASE_USE_EMULATOR: 'true',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
};

console.log(`[build-e2e] Building with emulator client config (project: ${PROJECT_ID})`);
const result = spawnSync('npx', ['next', 'build'], { stdio: 'inherit', env });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const marker = join(process.cwd(), '.next', 'E2E_BUILD.json');
writeFileSync(
  marker,
  JSON.stringify({ projectId: PROJECT_ID, builtAt: new Date().toISOString() }, null, 2),
);
console.log(`[build-e2e] Done. Marker written: ${marker}`);
