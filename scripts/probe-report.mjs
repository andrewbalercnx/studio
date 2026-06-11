#!/usr/bin/env node
/**
 * Aggregate UX-probe fragments into the run artifacts:
 *
 *   probe-results/findings.json — machine-readable run record; every finding
 *     is a codable fix-record (title/severity/surface/repro/suggested fix)
 *     whose shape maps onto a dev-todo. Findings are diffed against the
 *     committed e2e/probe/baseline-findings.json: `new` findings are the
 *     regressions; `known` ones are accepted/already-tracked friction.
 *
 *   probe-results/report.md — the PM-readable summary (W1-C check verdicts,
 *     persona scoreboard vs expert baseline, funnel walk, findings).
 *
 * Report-only by default (always exits 0 once artifacts are written).
 * Set PROBE_FAIL_ON_REGRESSION=1 to exit 1 on any FAIL verdict or NEW finding
 * (for anyone who wants a blocking wrapper later — CI does not set it).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const resultsDir = join(root, 'probe-results');
const fragmentsDir = join(resultsDir, 'fragments');
const baselinePath = join(root, 'e2e', 'probe', 'baseline-findings.json');

if (!existsSync(fragmentsDir)) {
  console.error(`[probe-report] No fragments at ${fragmentsDir} — run the probe first (npm run probe).`);
  process.exit(1);
}

const fragments = readdirSync(fragmentsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(fragmentsDir, f), 'utf8')))
  .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

if (fragments.length === 0) {
  console.error('[probe-report] Fragments directory is empty — nothing to report.');
  process.exit(1);
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout (e.g. exported artifact) */
}

const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : { findings: [] };
const baselineIds = new Set((baseline.findings || []).map((f) => f.id));

const runId = fragments[0].runId;
const w1cChecks = fragments
  .filter((f) => f.kind === 'w1c-check')
  .sort((a, b) => a.check.localeCompare(b.check, undefined, { numeric: true }));
const expertRuns = fragments.filter((f) => f.kind === 'expert-baseline');
const personaRuns = fragments.filter((f) => f.kind === 'persona-run');

const expertByGoal = new Map(expertRuns.map((f) => [f.goal, f]));

const scoredPersonaRuns = personaRuns.map((f) => {
  const expert = expertByGoal.get(f.goal);
  const score = { ...f.score };
  if (expert?.score?.success) {
    score.optimalActions = expert.score.actionsTaken;
    score.optimalWallMs = expert.score.wallMs;
    score.actionRatio =
      expert.score.actionsTaken > 0
        ? Number((score.actionsTaken / expert.score.actionsTaken).toFixed(2))
        : null;
  }
  return { ...f, score };
});

const allFindings = fragments
  .flatMap((f) => f.findings || [])
  .map((finding) => ({ ...finding, status: baselineIds.has(finding.id) ? 'known' : 'new' }));

const severityRank = { high: 0, medium: 1, low: 2 };
allFindings.sort(
  (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id),
);

const summary = {
  w1cChecks: {
    total: w1cChecks.length,
    pass: w1cChecks.filter((c) => c.verdict === 'PASS').length,
    fail: w1cChecks.filter((c) => c.verdict === 'FAIL').length,
  },
  personaRuns: {
    total: scoredPersonaRuns.length,
    succeeded: scoredPersonaRuns.filter((f) => f.score?.success).length,
    failed: scoredPersonaRuns.filter((f) => !f.score?.success).length,
  },
  findings: {
    total: allFindings.length,
    new: allFindings.filter((f) => f.status === 'new').length,
    known: allFindings.filter((f) => f.status === 'known').length,
  },
};

// ── findings.json ───────────────────────────────────────────────────────────
const artifact = {
  schemaVersion: 1,
  runId,
  generatedAt: new Date().toISOString(),
  commit,
  summary,
  w1cChecks: w1cChecks.map((c) => ({ check: c.check, title: c.checkTitle, verdict: c.verdict })),
  expertBaselines: expertRuns.map((f) => ({
    goal: f.goal,
    project: f.project,
    success: f.score?.success ?? false,
    actions: f.score?.actionsTaken,
    wallMs: f.score?.wallMs,
  })),
  personaRuns: scoredPersonaRuns.map((f) => ({
    persona: f.persona,
    goal: f.goal,
    project: f.project,
    score: f.score,
    funnel: f.funnel,
    hesitations: f.hesitations,
    deadEnds: f.deadEnds,
    steps: f.steps,
  })),
  findings: allFindings,
  concordance: {
    status: 'analytics-dark',
    note:
      'PostHog is gated behind Sprint-1 compliance sign-off. Probe funnel steps already use the ' +
      'canonical ANALYTICS_EVENTS names (see e2e/probe/concordance.ts) so the synthetic-vs-real ' +
      'funnel comparison activates without renaming once analytics is live.',
  },
};
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'findings.json'), JSON.stringify(artifact, null, 2));

// ── report.md ───────────────────────────────────────────────────────────────
const ms = (n) => (typeof n === 'number' ? `${(n / 1000).toFixed(1)}s` : '—');
const lines = [];
lines.push(`# UX Probe Report — run \`${runId}\``);
lines.push('');
lines.push(`| | |`);
lines.push(`|---|---|`);
lines.push(`| Generated | ${artifact.generatedAt} |`);
lines.push(`| Commit | \`${commit}\` |`);
lines.push(
  `| W1-C checks | ${summary.w1cChecks.pass}/${summary.w1cChecks.total} PASS${summary.w1cChecks.fail ? ` — **${summary.w1cChecks.fail} FAIL**` : ''} |`,
);
lines.push(
  `| Persona goals | ${summary.personaRuns.succeeded}/${summary.personaRuns.total} succeeded |`,
);
lines.push(
  `| Findings | ${summary.findings.total} (**${summary.findings.new} new**, ${summary.findings.known} known) |`,
);
lines.push('');

lines.push('## W1-C regression checks (original probe findings)');
lines.push('');
lines.push('| Check | Verdict | Finding under re-test |');
lines.push('|-------|---------|----------------------|');
for (const c of w1cChecks) {
  lines.push(`| ${c.check} | ${c.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${c.checkTitle} |`);
}
lines.push('');

lines.push('## Persona scoreboard');
lines.push('');
lines.push('| Persona | Goal | Outcome | Actions (vs optimal) | Wall clock (vs optimal) | Hesitations | Dead ends |');
lines.push('|---------|------|---------|----------------------|-------------------------|-------------|-----------|');
for (const f of [...expertRuns, ...scoredPersonaRuns]) {
  const s = f.score || {};
  const outcome = s.success ? '✅ success' : `❌ failed${s.failureReason ? ` — ${s.failureReason}` : ''}`;
  const actions =
    s.optimalActions != null
      ? `${s.actionsTaken} / ${s.optimalActions} (×${s.actionRatio})`
      : `${s.actionsTaken ?? '—'}`;
  const wall = s.optimalWallMs != null ? `${ms(s.wallMs)} / ${ms(s.optimalWallMs)}` : ms(s.wallMs);
  lines.push(
    `| ${f.persona}${f.kind === 'expert-baseline' ? ' (baseline)' : ''} | ${f.goal} | ${outcome} | ${actions} | ${wall} | ${(f.hesitations || []).length} | ${(f.deadEnds || []).length} |`,
  );
}
lines.push('');

lines.push('## Activation funnel (canonical event names)');
lines.push('');
const funnelRuns = scoredPersonaRuns.filter((f) => (f.funnel || []).length > 0);
if (funnelRuns.length) {
  const steps = funnelRuns[0].funnel.map((s) => s.step);
  lines.push(`| Step | ${funnelRuns.map((f) => f.persona).join(' | ')} |`);
  lines.push(`|------|${funnelRuns.map(() => '---').join('|')}|`);
  for (const step of steps) {
    const cells = funnelRuns.map((f) => {
      const r = (f.funnel || []).find((x) => x.step === step);
      if (!r || !r.reached) return '✗';
      return r.simulated ? '✓ (seam)' : '✓';
    });
    lines.push(`| \`${step}\` | ${cells.join(' | ')} |`);
  }
} else {
  lines.push('_No funnel-bearing persona runs in this run._');
}
lines.push('');

lines.push('## Findings (codable fix-records)');
lines.push('');
if (allFindings.length === 0) {
  lines.push('_No findings — all personas completed their goals on the expected affordances._');
} else {
  for (const f of allFindings) {
    lines.push(`### ${f.status === 'new' ? '🆕 ' : ''}[${f.severity.toUpperCase()}] ${f.summary}`);
    lines.push('');
    lines.push(`- **Id**: \`${f.id}\` (${f.status})`);
    lines.push(`- **Surface**: ${f.surface}`);
    lines.push(`- **Category**: ${f.category}`);
    lines.push(`- **Repro**:`);
    for (const step of f.reproSteps) lines.push(`  1. ${step}`);
    lines.push(`- **Suggested fix**: ${f.suggestedFix}`);
    lines.push('');
  }
}

lines.push('## PostHog concordance');
lines.push('');
lines.push(artifact.concordance.note);
lines.push('');

writeFileSync(join(resultsDir, 'report.md'), lines.join('\n'));

console.log(
  `[probe-report] ${summary.w1cChecks.pass}/${summary.w1cChecks.total} W1-C checks PASS, ` +
    `${summary.personaRuns.succeeded}/${summary.personaRuns.total} persona goals succeeded, ` +
    `${summary.findings.total} finding(s) (${summary.findings.new} new).`,
);
console.log(`[probe-report] Wrote ${join(resultsDir, 'findings.json')}`);
console.log(`[probe-report] Wrote ${join(resultsDir, 'report.md')}`);

if (
  process.env.PROBE_FAIL_ON_REGRESSION === '1' &&
  (summary.w1cChecks.fail > 0 || summary.findings.new > 0)
) {
  console.error('[probe-report] PROBE_FAIL_ON_REGRESSION=1 and regressions present — exiting 1.');
  process.exit(1);
}
