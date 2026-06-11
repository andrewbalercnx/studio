#!/usr/bin/env node
/**
 * `npm run probe` — run the mechanical UX probe end-to-end:
 *
 *   1. Ensure the E2E build exists (build it if the marker is missing).
 *   2. Run the probe specs (Playwright `probe` project) against the Firebase
 *      emulators + TEST_MODE app server. Playwright boots both itself via its
 *      webServer config unless PLAYWRIGHT_BASE_URL points at a running stack.
 *      Single worker: the probe measures one user at a time, and two checks
 *      seed shared catalog docs they remove afterwards.
 *   3. Aggregate fragments into probe-results/findings.json + report.md.
 *
 * Exit code reflects HARNESS health only (build/spec infrastructure errors).
 * Probe findings and FAIL verdicts are report content, not failures — this is
 * a detector, not a gate (see docs/testing/probe.md).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const runId = `probe-${new Date().toISOString().replace(/[:.]/g, '-')}`;

function run(cmd, args, extraEnv = {}) {
  console.log(`[run-probe] $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return res.status ?? 1;
}

// 1. E2E build (emulator client config + marker) — reuse if present.
if (!existsSync(join(root, '.next', 'E2E_BUILD.json'))) {
  console.log('[run-probe] No E2E build marker — running build:e2e first.');
  const code = run('npm', ['run', 'build:e2e']);
  if (code !== 0) process.exit(code);
}

// 2. Fresh fragments dir (stale fragments from earlier runs would pollute the report).
const fragmentsDir = join(root, 'probe-results', 'fragments');
rmSync(fragmentsDir, { recursive: true, force: true });
mkdirSync(fragmentsDir, { recursive: true });

// 3. Probe specs.
const specCode = run('npx', ['playwright', 'test', '--project=probe', '--workers=1'], {
  PROBE_RUN_ID: runId,
});

// 4. Report (always attempt — partial fragments still tell the story).
const reportCode = run('node', ['scripts/probe-report.mjs']);

if (specCode !== 0) {
  console.error('[run-probe] Probe specs reported harness errors (see above).');
  process.exit(specCode);
}
process.exit(reportCode);
