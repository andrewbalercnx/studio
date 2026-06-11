import { test, expect } from 'playwright/test';
import type { Page, TestInfo } from 'playwright/test';
import {
  SEED,
  cleanupFunnelAccount,
  emulatorFirestore,
  seedCatalog,
} from '../helpers/emulator';
import {
  createChildViaParentUI,
  lockKidsModeToChild,
  signUpNewParent,
  type ParentAccount,
} from '../helpers/flows';
import { currentRunId, writeFragment } from './artifacts';
import {
  removeJargonGenerator,
  removeStartupTour,
  seedJargonGenerator,
  seedStartupTour,
} from './seeds';
import type { Finding, FindingSeverity, RunFragment } from './types';

/**
 * @probe — W1-C regression checks: the seven findings from the original
 * naive-agent probe run (docs/usability/UX-PROBE-FINDINGS-2026-06-05.md),
 * re-verified mechanically against the fixes now on main.
 *
 * Each check emits a PASS/FAIL fragment. FAIL produces a codable finding
 * record but does NOT fail the Playwright test (the probe is report-only);
 * only harness/precondition errors fail tests. A deliberately reintroduced
 * W1-C bug therefore shows up as a FAIL verdict + finding in the report —
 * the W2-A exit criterion.
 */

type CheckDef = {
  id: string;
  title: string;
  severity: FindingSeverity;
  surface: string;
  category: string;
  reproSteps: string[];
  suggestedFix: string;
};

const CHECKS: Record<string, CheckDef> = {
  'W1C-1': {
    id: 'W1C-1',
    title: '"End Tour" returns to home, not the signup page',
    severity: 'high',
    surface: '/ (welcome tour)',
    category: 'navigation',
    reproSteps: [
      'Sign up a new account (a live default-startup tour exists)',
      'Wait for the welcome tour dialog to auto-open',
      'Click "End Tour"',
      'Observe where the app navigates',
    ],
    suggestedFix: 'End Tour must route to "/" (Who is playing?), never back to /signup or /login.',
  },
  'W1C-2': {
    id: 'W1C-2',
    title: 'Manage Children offers "Play as <child>" to start acting for a child',
    severity: 'high',
    surface: '/parent/children',
    category: 'discoverability',
    reproSteps: [
      'Sign up and create a child "Ezra Probe"',
      'On /parent/children, look at the child card actions',
      'Click "Play as Ezra Probe"',
    ],
    suggestedFix: 'Each child card needs a primary "Play as <name>" action that enters child mode.',
  },
  'W1C-3': {
    id: 'W1C-3',
    title: 'A visible "Switch child" control exists in child-mode navigation',
    severity: 'high',
    surface: 'header (child mode)',
    category: 'navigation',
    reproSteps: [
      'Enter child mode via "Play as <child>"',
      'Look for a way to switch children in the header',
      'Click "Switch child"',
    ],
    suggestedFix: 'Keep a "Switch child" nav button in child mode routing to "Who is playing?".',
  },
  'W1C-4': {
    id: 'W1C-4',
    title: 'No auto-created "My First Child" placeholder; explicit first-run prompt instead',
    severity: 'medium',
    surface: '/ (post-signup)',
    category: 'content',
    reproSteps: [
      'Sign up a fresh account',
      'Inspect the home screen and the children collection',
    ],
    suggestedFix:
      'Signup must not seed a placeholder child; show the "Add your first child" prompt.',
  },
  'W1C-5': {
    id: 'W1C-5',
    title: 'Story-method chooser hides model jargon and badges one recommended option',
    severity: 'medium',
    surface: '/kids/create',
    category: 'labelling',
    reproSteps: [
      'Seed a generator stored with model jargon ("Gemini Free", model names in description)',
      'Open /kids/create as a locked child',
      'Inspect the generator cards',
    ],
    suggestedFix:
      'Serve generators through the presentation layer: scrub model jargon, badge exactly one option "Recommended for first-timers".',
  },
  'W1C-6': {
    id: 'W1C-6',
    title: 'No redundant PIN re-entry immediately after signup (fresh-PIN grace)',
    severity: 'low',
    surface: '/parent/children (post-signup)',
    category: 'feedback',
    reproSteps: [
      'Sign up (choosing and confirming a PIN)',
      'Click through to the parent area (e.g. "Add your first child")',
      'Observe whether the PIN dialog demands the same PIN again',
    ],
    suggestedFix: 'Treat the guard as just-validated for a grace window after signup sets the PIN.',
  },
  'W1C-7': {
    id: 'W1C-7',
    title: 'Wizard waits are clearly narrated (expectation-setting progress copy)',
    severity: 'low',
    surface: '/kids/create (wizard)',
    category: 'feedback',
    reproSteps: [
      'As a locked child, open story creation and pick the Story Wizard',
      'While the wizard call is in flight, inspect the waiting screen',
    ],
    suggestedFix:
      'Narrate every wizard wait (what is happening + how long it takes), never a bare spinner.',
  },
};

function emitVerdict(
  testInfo: TestInfo,
  check: CheckDef,
  pass: boolean,
  detail: string,
  extraFindings: Finding[] = [],
): void {
  const findings: Finding[] = pass
    ? [...extraFindings]
    : [
        {
          id: `w1c-regression--${check.id.toLowerCase()}`,
          severity: check.severity,
          surface: check.surface,
          category: 'regression',
          summary: `REGRESSION of ${check.id}: ${check.title} — ${detail}`,
          reproSteps: check.reproSteps,
          suggestedFix: check.suggestedFix,
          source: { kind: 'w1c-check', check: check.id },
        },
        ...extraFindings,
      ];
  const fragment: RunFragment = {
    schemaVersion: 1,
    runId: currentRunId(),
    kind: 'w1c-check',
    project: testInfo.project.name,
    check: check.id,
    checkTitle: check.title,
    verdict: pass ? 'PASS' : 'FAIL',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    steps: [],
    funnel: [],
    hesitations: [],
    deadEnds: [],
    findings,
  };
  writeFragment(fragment);
  console.log(`[probe] ${check.id} ${pass ? 'PASS' : 'FAIL'} — ${check.title}${pass ? '' : ` (${detail})`}`);
}

test.describe('W1-C probe-finding regression checks @probe', () => {
  let account: ParentAccount | undefined;

  test.afterEach(async () => {
    if (account) {
      await cleanupFunnelAccount({ uid: account.uid }).catch(() => {});
      account = undefined;
    }
  });

  test('W1C-1: End Tour returns home', async ({ page }, testInfo) => {
    await seedStartupTour();
    try {
      account = await signUpNewParent(page, 'probe-w1c1');
      // The startup trigger checks once per mount and may have run before the
      // users doc existed; a reload guarantees a fresh check with the doc
      // present (deterministic tour launch).
      await page.reload();
      const endTour = page.getByRole('button', { name: 'End Tour' });
      await expect(endTour).toBeVisible({ timeout: 30_000 });
      await endTour.click();

      // Verdict: we must land on the home/"Who is playing?" screen, NOT /signup.
      let pass = true;
      let detail = '';
      try {
        await expect(page.getByText('Who is playing?')).toBeVisible({ timeout: 15_000 });
        await expect(page).not.toHaveURL(/\/(signup|login)(\?|$)/);
      } catch {
        pass = false;
        detail = `ended on ${new URL(page.url()).pathname} without the "Who is playing?" screen`;
      }
      emitVerdict(testInfo, CHECKS['W1C-1'], pass, detail);
    } finally {
      await removeStartupTour();
    }
  });

  test('W1C-2 + W1C-3: Play-as affordance and Switch-child nav', async ({ page }, testInfo) => {
    account = await signUpNewParent(page, 'probe-w1c23');
    await createChildViaParentUI(page, account, 'Ezra Probe');

    // W1C-2: the child card exposes a "Play as" action that enters child mode.
    let pass2 = true;
    let detail2 = '';
    const playAs = page.getByRole('button', { name: 'Play as Ezra Probe' });
    try {
      await expect(playAs).toBeVisible({ timeout: 10_000 });
      await playAs.click();
      await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 15_000 });
    } catch {
      pass2 = false;
      detail2 = 'no working "Play as <child>" action on the child card';
    }
    emitVerdict(testInfo, CHECKS['W1C-2'], pass2, detail2);

    // W1C-3: child mode shows a "Switch child" nav control back to the chooser.
    let pass3 = true;
    let detail3 = '';
    if (!pass2) {
      pass3 = false;
      detail3 = 'unreachable: could not enter child mode (see W1C-2)';
    } else {
      const switchChild = page.getByRole('button', { name: 'Switch child' });
      try {
        await expect(switchChild).toBeVisible({ timeout: 10_000 });
        await switchChild.click();
        await expect(page.getByText('Who is playing?')).toBeVisible({ timeout: 15_000 });
      } catch {
        pass3 = false;
        detail3 = 'no working "Switch child" control in child-mode navigation';
      }
    }
    emitVerdict(testInfo, CHECKS['W1C-3'], pass3, detail3);
  });

  test('W1C-4: no placeholder child auto-seeded', async ({ page }, testInfo) => {
    account = await signUpNewParent(page, 'probe-w1c4');

    let pass = true;
    let detail = '';
    try {
      await expect(page.getByText('Add your first child').first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText('My First Child')).toHaveCount(0);
      const children = await emulatorFirestore()
        .collection('children')
        .where('ownerParentUid', '==', account.uid)
        .get();
      if (!children.empty) {
        pass = false;
        detail = `signup seeded ${children.size} child doc(s): ${children.docs
          .map((d) => d.data().displayName)
          .join(', ')}`;
      }
    } catch {
      pass = false;
      detail = 'placeholder child rendered or first-run prompt missing after signup';
    }
    emitVerdict(testInfo, CHECKS['W1C-4'], pass, detail);
  });

  test('W1C-5: generator chooser hides jargon, badges a recommendation', async ({ page }, testInfo) => {
    await seedCatalog();
    await seedJargonGenerator();
    try {
      account = await signUpNewParent(page, 'probe-w1c5');
      await createChildViaParentUI(page, account, 'Ezra Probe');
      await lockKidsModeToChild(page, 'Ezra Probe');
      await page.goto('/kids/create');
      await expect(page.getByText(SEED.generatorName)).toBeVisible({ timeout: 30_000 });
      // The jargon generator renders under its kid-friendly presentation name.
      await expect(page.getByText('Free Play')).toBeVisible({ timeout: 15_000 });

      let pass = true;
      const problems: string[] = [];
      const jargonCount = await page
        .getByText(/\b(gemini|gpt|claude|openai|llm|vertex)\b/i)
        .count();
      if (jargonCount > 0) {
        pass = false;
        problems.push(`${jargonCount} visible element(s) containing model jargon`);
      }
      const badgeCount = await page.getByText('Recommended for first-timers').count();
      if (badgeCount !== 1) {
        pass = false;
        problems.push(`expected exactly 1 "Recommended for first-timers" badge, found ${badgeCount}`);
      }
      emitVerdict(testInfo, CHECKS['W1C-5'], pass, problems.join('; '));
    } finally {
      await removeJargonGenerator();
    }
  });

  test('W1C-6: no redundant PIN prompt right after signup', async ({ page }, testInfo) => {
    account = await signUpNewParent(page, 'probe-w1c6');

    // The original POC repro: the user clicks through to the parent area
    // right after signup (client-side navigation).
    await page.getByRole('link', { name: 'Add your first child' }).click();

    let pass = true;
    let detail = '';
    try {
      await expect(page.getByRole('button', { name: /add new child/i })).toBeVisible({
        timeout: 15_000,
      });
      if (await page.getByText('Enter Parent PIN').isVisible().catch(() => false)) {
        pass = false;
        detail = 'PIN dialog demanded the PIN chosen seconds earlier';
      }
    } catch {
      // Content never appeared — most likely blocked by the PIN dialog.
      pass = false;
      detail = (await page.getByText('Enter Parent PIN').isVisible().catch(() => false))
        ? 'PIN dialog demanded the PIN chosen seconds earlier'
        : 'parent area did not render after signup';
    }

    // Adjacent probe: does the grace survive a FULL page reload? The persisted
    // sessionStorage timestamp says it should (docs/testing/pin-guard.md §4:
    // "guard state persists across page refreshes within the five-minute
    // window"), so a re-prompt here is an app bug worth a standing finding —
    // it affects every unlocked parent session, not just post-signup.
    const extraFindings: Finding[] = [];
    await page.goto('/parent/children');
    const reloadPrompted = await page
      .getByText('Enter Parent PIN')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (reloadPrompted) {
      extraFindings.push({
        id: 'pin-guard--grace-lost-on-full-reload',
        severity: 'medium',
        surface: '/parent/* (PIN guard)',
        category: 'feedback',
        summary:
          'PIN guard re-prompts on a full page reload even though the persisted grace timestamp is present and unexpired',
        reproSteps: [
          'Sign up (PIN is set; guard grace begins) — or unlock any parent page with the PIN',
          'Hard-reload /parent/children (sessionStorage still holds an unexpired storypic.parentGuard.lastValidatedAt:<uid>)',
          'The "Enter Parent PIN" dialog appears anyway',
        ],
        suggestedFix:
          'In ParentGuardProvider, defer the modal-open decision until the persisted lastValidatedAt has hydrated (and close the modal if hydration proves the guard valid).',
        source: { kind: 'w1c-check', check: 'W1C-6' },
      });
    }
    emitVerdict(testInfo, CHECKS['W1C-6'], pass, detail, extraFindings);
  });

  test('W1C-7: wizard wait is clearly narrated', async ({ page }, testInfo) => {
    await seedCatalog();
    account = await signUpNewParent(page, 'probe-w1c7');
    await createChildViaParentUI(page, account, 'Ezra Probe');
    await lockKidsModeToChild(page, 'Ezra Probe');
    await page.getByText('Create New Story').click();
    await expect(
      page.getByRole('heading', { name: 'How do you want to create your story?' }),
    ).toBeVisible({ timeout: 30_000 });

    // Stall the wizard's server action so the waiting state stays observable
    // (no TEST_MODE seam exists for the wizard — it is a live AI call in prod).
    await page.route('**/*', async (route) => {
      const req = route.request();
      const isServerAction =
        req.method() === 'POST' && (await req.headerValue('next-action')) !== null;
      if (isServerAction) return; // hold the request open
      await route.continue();
    });

    // Scope of this check: the FIRST wizard wait (initialisation) must show
    // narrated, wizard-specific copy instead of a bare spinner. The deeper
    // W1-A narration ("The wizard is thinking..." between questions,
    // "Question N of 4" progress) sits past a live AI response and stays
    // unverifiable until a TEST_MODE seam exists for the wizard flow — see
    // docs/testing/probe.md (known gaps).
    let pass = true;
    let detail = '';
    try {
      await page.getByText(SEED.generatorName).click();
      await expect(page.getByText('Summoning the Story Wizard...')).toBeVisible({
        timeout: 20_000,
      });
    } catch {
      pass = false;
      detail = 'wizard initialisation wait lacks narration (no wizard-specific waiting copy)';
    } finally {
      await page.unroute('**/*').catch(() => {});
    }
    emitVerdict(testInfo, CHECKS['W1C-7'], pass, detail);
  });
});
