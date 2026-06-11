import { test, expect, type Page, type TestInfo } from 'playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  SEED,
  cleanupFunnelAccount,
  findChildId,
  seedCatalog,
  seedCompletedStory,
  seedReadyStorybook,
} from './helpers/emulator';
import {
  createChildViaParentUI,
  lockKidsModeToChild,
  passParentPinGuardIfPresent,
  signUpNewParent,
  type ParentAccount,
} from './helpers/flows';

/**
 * @a11y — axe-core accessibility scans of the key funnel pages.
 *
 * REPORT-ONLY: violations are attached to the test report and summarised in
 * the log, but do not fail the run. Promotion criterion (docs/testing/e2e.md):
 * once the serious/critical count is at zero and stays there for 2 weeks of
 * runs, set A11Y_ENFORCE=1 in CI to turn these into hard assertions.
 */

const ENFORCE = process.env.A11Y_ENFORCE === '1';

async function runAxe(page: Page, testInfo: TestInfo, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  await testInfo.attach(`axe-${surface}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });

  const summary = results.violations.map(
    (v) => `${v.impact ?? 'n/a'}: ${v.id} (${v.nodes.length} node(s)) — ${v.help}`,
  );
  console.log(
    `[a11y] ${surface}: ${results.violations.length} violation type(s)` +
      (summary.length ? `\n  ${summary.join('\n  ')}` : ''),
  );

  if (ENFORCE) {
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      seriousOrWorse,
      `serious/critical axe violations on ${surface}`,
    ).toEqual([]);
  }
}

test.describe('accessibility scans @a11y', () => {
  test('signup page', async ({ page }, testInfo) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: 'Sign Up' })).toBeVisible();
    await runAxe(page, testInfo, 'signup');
  });

  test.describe('authenticated surfaces', () => {
    let account: ParentAccount | undefined;

    test.afterEach(async () => {
      if (account) {
        await cleanupFunnelAccount({ uid: account.uid });
        account = undefined;
      }
    });

    // Signup no longer seeds a default child (515c81b) — surfaces that need a
    // child create one through the parent UI first.

    test('who-is-playing page', async ({ page }, testInfo) => {
      account = await signUpNewParent(page, 'a11y-who');
      // No placeholder child is seeded at signup anymore (W1-C): the page
      // shows the "Add your first child" first-run prompt.
      await expect(page.getByText('Add your first child').first()).toBeVisible();
      await runAxe(page, testInfo, 'who-is-playing');
    });

    test('story creation page', async ({ page }, testInfo) => {
      await seedCatalog();
      account = await signUpNewParent(page, 'a11y-create');
      await createChildViaParentUI(page, account, 'Ellie A11y');
      await lockKidsModeToChild(page, 'Ellie A11y');
      await page.goto('/kids/create');
      await expect(page.getByText(SEED.generatorName)).toBeVisible({ timeout: 30_000 });
      await runAxe(page, testInfo, 'story-creation');
    });

    test('storybook view page', async ({ page }, testInfo) => {
      await seedCatalog();
      account = await signUpNewParent(page, 'a11y-books');
      await createChildViaParentUI(page, account, 'Ellie A11y');
      const childId = await findChildId(account.uid, 'Ellie A11y');
      const { sessionId } = await seedCompletedStory({ parentUid: account.uid, childId });
      await seedReadyStorybook({ storyId: sessionId });
      await lockKidsModeToChild(page, 'Ellie A11y');

      // Client-side navigation — kids surfaces crash on cold deep-links while
      // auth hydrates (known app issue, see docs/testing/e2e.md).
      await page.getByText('My Books').click();
      await expect(page.getByText(SEED.storyTitle)).toBeVisible({ timeout: 30_000 });
      await runAxe(page, testInfo, 'storybook-view');
    });

    test('orders page', async ({ page }, testInfo) => {
      account = await signUpNewParent(page, 'a11y-orders');
      await page.goto('/parent/orders');
      // Fresh-PIN grace (W1-C): right after signup the PIN dialog may not
      // appear at all — pass it only if shown.
      await passParentPinGuardIfPresent(page, account.pin, page.getByText(/order/i).first());
      await runAxe(page, testInfo, 'orders');
    });
  });
});
