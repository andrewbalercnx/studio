#!/usr/bin/env node
/**
 * Start the Firebase emulators for the E2E suite (auth/firestore/storage,
 * offline `demo-` project). Launched by playwright.config.ts's webServer or
 * directly by CI.
 *
 * firebase-tools 15+ requires Java 21. If the PATH java is older/missing this
 * looks in the common Homebrew/Linux locations for a JDK 21+ before giving up,
 * so local runs work without shell profile changes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || 'demo-storypic-e2e';

function javaMajorVersion(binDir) {
  const java = binDir ? join(binDir, 'java') : 'java';
  const res = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) return 0;
  // "openjdk version "21.0.2"" — version line goes to stderr.
  const match = `${res.stderr}${res.stdout}`.match(/version "(\d+)[.\d]*/);
  return match ? Number(match[1]) : 0;
}

function findJavaBinDir() {
  if (javaMajorVersion(null) >= 21) return null; // PATH java is fine.
  const candidates = [
    '/opt/homebrew/opt/openjdk@21/bin',
    '/opt/homebrew/opt/openjdk/bin',
    '/usr/local/opt/openjdk@21/bin',
    '/usr/local/opt/openjdk/bin',
    '/usr/lib/jvm/temurin-21-jdk-amd64/bin',
    '/usr/lib/jvm/java-21-openjdk-amd64/bin',
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'java')) && javaMajorVersion(dir) >= 21) return dir;
  }
  console.error(
    '[start-e2e-emulators] No Java 21+ found (firebase-tools 15 requires it). ' +
      'Install one, e.g. `brew install openjdk@21`.',
  );
  process.exit(1);
}

const javaBinDir = findJavaBinDir();
const env = { ...process.env };
if (javaBinDir) {
  env.PATH = `${javaBinDir}${delimiter}${env.PATH}`;
  console.log(`[start-e2e-emulators] Using Java from ${javaBinDir}`);
}

console.log(`[start-e2e-emulators] firebase emulators:start (project ${PROJECT_ID})`);
const child = spawn(
  'firebase',
  ['emulators:start', '--only', 'auth,firestore,storage', '--project', PROJECT_ID],
  { env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
// Forward termination so Playwright can shut the emulators down cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
