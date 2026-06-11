import { test, devices } from 'playwright/test';
import type { Page, TestInfo } from 'playwright/test';
import { cleanupFunnelAccount } from '../helpers/emulator';
import { currentRunId, writeFragment } from './artifacts';
import { PROBE_FUNNEL_STEPS } from './concordance';
import { PersonaDriver } from './driver';
import { READ_EXISTING_BOOK, REACH_FINISHED_BOOK, type GoalContext, type GoalDef } from './goals';
import { EXPERT, FIRST_TIME_PARENT, IMPATIENT_PARENT, RETURNING_CHILD } from './personas';
import { BudgetExceededError, DeadEndError, ProbeRecorder } from './recorder';
import type { Persona } from './types';

/**
 * @probe — persona runs (report-only).
 *
 * Each test executes one (persona × goal) pair through the perception-
 * constrained driver, records every step/hesitation/dead-end, and writes a
 * fragment to probe-results/fragments/. The Playwright test FAILS only on
 * harness errors — a persona failing its goal is a probe RESULT (captured as
 * findings + a failed score), not a test failure. scripts/probe-report.mjs
 * turns the fragments into the findings artifact + markdown report.
 *
 * Run via `npm run probe` (single worker — the probe measures one user at a
 * time, and some checks seed shared catalog docs).
 */

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function surfaceOf(page: Page): string {
  try {
    return new URL(page.url()).pathname || '/';
  } catch {
    return 'unknown';
  }
}

async function runGoalAs(
  persona: Persona,
  goal: GoalDef,
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const rec = new ProbeRecorder(persona);
  const drv = new PersonaDriver(page, rec);
  const ctx: GoalContext = {
    page,
    drv,
    rec,
    tag: `${goal.id.slice(0, 12)}-${persona.id.slice(0, 12)}`,
    state: {},
  };

  let success = false;
  let harnessError: unknown;

  try {
    await goal.prepare?.(ctx);
  } catch (e) {
    harnessError = e;
    rec.fail(`precondition setup failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!harnessError) {
    try {
      await goal.run(ctx);
      success = true;
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        rec.fail(e.reason);
        rec.addFinding({
          id: `${goal.id}--${persona.id}--budget-exhausted`,
          severity: 'high',
          surface: surfaceOf(page),
          category: 'navigation',
          summary: `${persona.name} ran out of budget (${e.reason}) before completing "${goal.title}"`,
          reproSteps: rec.steps.slice(-6).map((s) => `${s.intent} → ${s.target} (${s.outcome})`),
          suggestedFix:
            'Shorten the path to this goal: reduce required actions or surface the next step more prominently where the persona stalled.',
          source: { kind: 'persona-run', persona: persona.id, goal: goal.id },
        });
      } else if (e instanceof DeadEndError) {
        rec.fail(e.message);
        rec.addFinding({
          id: `${goal.id}--${persona.id}--deadend--${slug(e.intent)}`,
          severity: 'high',
          surface: surfaceOf(page),
          category: 'discoverability',
          summary: `${persona.name} hit a dead end trying to "${e.intent}" on ${surfaceOf(page)}`,
          reproSteps: [
            ...rec.steps.slice(-6).map((s) => `${s.intent} → ${s.target} (${s.outcome})`),
            `then looked for: ${e.attempted.join(' | ')} — none present/usable`,
          ],
          suggestedFix: `Add a visible, accessibly-named affordance for "${e.intent}" on ${surfaceOf(page)}.`,
          source: { kind: 'persona-run', persona: persona.id, goal: goal.id },
        });
      } else {
        harnessError = e;
        rec.fail(`harness error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Fallback-used hesitations are findings in their own right: the primary
  // affordance a naive user expects was missing even though a detour existed.
  for (const h of rec.hesitations.filter((x) => x.reason === 'fallback-used')) {
    rec.addFinding({
      id: `${goal.id}--${persona.id}--fallback--${slug(h.intent)}`,
      severity: 'medium',
      surface: surfaceOf(page),
      category: 'discoverability',
      summary: `${persona.name} needed a fallback affordance to "${h.intent}" (${h.detail})`,
      reproSteps: rec.steps
        .filter((s) => s.intent === h.intent)
        .map((s) => `${s.intent} → ${s.target} (${s.outcome})`),
      suggestedFix: `Restore/promote the primary affordance for "${h.intent}".`,
      source: { kind: 'persona-run', persona: persona.id, goal: goal.id },
    });
  }

  // Activation-goal runs report the canonical funnel including missed steps.
  if (goal.id === REACH_FINISHED_BOOK.id) {
    const reached = new Set(rec.funnel.map((f) => f.step));
    for (const step of PROBE_FUNNEL_STEPS) {
      if (!reached.has(step)) rec.markFunnelStepMissed(step);
    }
  }

  const fragmentPath = writeFragment(
    rec.fragment(
      {
        runId: currentRunId(),
        kind: persona.id === EXPERT.id ? 'expert-baseline' : 'persona-run',
        project: testInfo.project.name,
        goal: goal.id,
        persona: persona.id,
      },
      success,
    ),
  );
  console.log(
    `[probe] ${persona.id} × ${goal.id}: ${success ? 'SUCCESS' : `FAILED (${rec.score(false).failureReason})`} ` +
      `— ${rec.actionCount} actions, ${rec.elapsedMs()}ms → ${fragmentPath}`,
  );

  if (ctx.state.uid) {
    await cleanupFunnelAccount({ uid: ctx.state.uid }).catch(() => {});
  }
  if (harnessError) throw harnessError;
}

test.describe('UX probe — activation goal @probe', () => {
  test('expert baseline: reach a finished book', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await runGoalAs(EXPERT, REACH_FINISHED_BOOK, page, testInfo);
  });

  test('impatient parent: reach a finished book', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await runGoalAs(IMPATIENT_PARENT, REACH_FINISHED_BOOK, page, testInfo);
  });

  test('first-time parent: reach a finished book', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await runGoalAs(FIRST_TIME_PARENT, REACH_FINISHED_BOOK, page, testInfo);
  });
});

// The returning child re-opens the PWA on a phone — emulate the Pixel 7
// viewport/touch profile (browser type itself can't change inside a describe,
// so defaultBrowserType is deliberately not spread in).
const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];

test.describe('UX probe — retention goal (mobile) @probe', () => {
  test.use(pixel7);

  test('expert baseline: read an existing book', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await runGoalAs(EXPERT, READ_EXISTING_BOOK, page, testInfo);
  });

  test('returning child: read an existing book', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    await runGoalAs(RETURNING_CHILD, READ_EXISTING_BOOK, page, testInfo);
  });
});
