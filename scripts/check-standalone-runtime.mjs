#!/usr/bin/env node
/**
 * After `next build`: load the server-only packages that production loads but
 * CI does not exercise (E2E runs jobs in-process) from the standalone output,
 * the tree App Hosting deploys. Catches a package that was bundled when it must
 * be external, or traced without the files it loads at runtime.
 *
 *   node scripts/check-standalone-runtime.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const standalone = resolve('.next/standalone');
const serverChunks = resolve('.next/server/chunks');
if (!existsSync(join(standalone, 'server.js'))) {
  console.error('[standalone-check] .next/standalone/server.js not found: run the build first.');
  process.exit(1);
}

let failures = 0;
function report(label, problem) {
  if (problem) failures += 1;
  console.log(`${problem ? 'FAIL' : 'PASS'}  ${label}${problem ? `: ${problem}` : ''}`);
}

// 1. Not bundled: a bundled copy has its computed require replaced by a stub that always throws.
const bundled = existsSync(serverChunks)
  ? readdirSync(serverChunks, { recursive: true }).filter((name) => {
      if (!String(name).endsWith('.js')) return false;
      const text = readFileSync(join(serverChunks, name), 'utf8');
      return text.includes('cloud_tasks_client') && text.includes('expression is too dynamic');
    })
  : [];
report('@google-cloud/tasks is not bundled into server chunks', bundled.length ? `bundled with a broken require in ${bundled.join(', ')}` : null);

// 2. Loadable from the deployed tree, resolved as the server resolves it (ESM import from standalone).
const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { CloudTasksClient } = await import('@google-cloud/tasks');
  // Offline: dummy credentials are enough to load the protos and client config.
  const client = new CloudTasksClient({ projectId: 'check', credentials: { client_email: 'check@check.iam.gserviceaccount.com', private_key: 'unused' } });
  await client.initialize();
  client.queuePath('check', 'europe-west1', 'ai-text');
  await client.close();
`], { cwd: standalone, encoding: 'utf8' });
report(
  '@google-cloud/tasks loads and initialises from .next/standalone',
  probe.status === 0 ? null : (probe.stderr.split('\n').find((line) => line.startsWith('Error')) ?? probe.stderr.slice(0, 300))
);

console.log(failures ? `${failures} standalone check(s) FAILED` : 'Standalone runtime checks passed');
process.exit(failures ? 1 : 0);
