/**
 * Fragment writer: each probe spec writes its result as one JSON file under
 * probe-results/fragments/. scripts/probe-report.mjs merges them into the
 * findings artifact + PM-readable markdown report after the Playwright run.
 *
 * Using per-spec fragment files (instead of one shared artifact) keeps specs
 * independent under Playwright's worker model — no cross-test state, no write
 * races (file names are unique per fragment).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunFragment } from './types';

export const PROBE_RESULTS_DIR = join(process.cwd(), 'probe-results');
export const FRAGMENTS_DIR = join(PROBE_RESULTS_DIR, 'fragments');

/** One id per probe invocation; all fragments of a run share it. The runner
 * (scripts/run-probe.mjs) sets PROBE_RUN_ID; ad-hoc spec runs get a fallback. */
export function currentRunId(): string {
  return process.env.PROBE_RUN_ID || `adhoc-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

let fragmentCounter = 0;

export function writeFragment(fragment: RunFragment): string {
  mkdirSync(FRAGMENTS_DIR, { recursive: true });
  const name = [
    fragment.kind,
    fragment.goal ?? fragment.check ?? 'misc',
    fragment.persona ?? '',
    fragment.project,
    `${process.pid}-${++fragmentCounter}`,
  ]
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-');
  const path = join(FRAGMENTS_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(fragment, null, 2));
  return path;
}
