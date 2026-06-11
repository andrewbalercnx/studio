import { test, expect } from 'playwright/test';
import {
  SEED,
  cleanupFunnelAccount,
  findChildId,
  seedCatalog,
  seedCompletedStory,
} from './helpers/emulator';
import {
  createChildViaParentUI,
  lockKidsModeToChild,
  signUpNewParent,
  type ParentAccount,
} from './helpers/flows';

/**
 * @funnel — THE blocking happy-path spec.
 *
 * Covers the activation funnel end-to-end against the Firebase emulator with
 * the TEST_MODE AI seam active on the server:
 *
 *   signup → parent creates child → story creation entry →
 *   story completion (deterministic seam) → storybook generation → book ready
 *
 * Determinism notes:
 *  - Storybook generation (pages/images/audio/exemplars) runs through the real
 *    /api/storybookV2/* routes, short-circuited to fixtures by TEST_MODE=1.
 *  - Story creation/completion has NO server-side seam (the wizard is a live
 *    Gemini call), so the spec asserts the creation entry UI, then seeds the
 *    completed story exactly as the wizard + storyCompile would have written
 *    it, and resumes UI-driven from the style picker. See docs/testing/e2e.md.
 *  - Checkout/pay is out of scope (Stripe deferred to sprint WG-1).
 */

const CHILD_NAME = 'Ellie Test';

test.describe('parent activation funnel @funnel', () => {
  test.beforeAll(async () => {
    await seedCatalog();
  });

  let account: ParentAccount | undefined;

  test.afterEach(async () => {
    if (account) {
      await cleanupFunnelAccount({ uid: account.uid });
      account = undefined;
    }
  });

  test('signup → create child → story → storybook generation → book ready', async ({ page }) => {
    test.setTimeout(180_000);

    // ── 1. Signup (creates account + default child + PIN, lands on selector) ──
    account = await signUpNewParent(page, 'funnel');
    await expect(page.getByText('My First Child')).toBeVisible();

    // ── 2. Parent creates a child (PIN guard + create dialog) ──
    await createChildViaParentUI(page, account, CHILD_NAME);
    const childId = await findChildId(account.uid, CHILD_NAME);

    // ── 3. Kids mode: lock to the new child ("who is playing") ──
    await lockKidsModeToChild(page, CHILD_NAME);

    // ── 4. Story creation entry: generator choices render for this child ──
    await page.getByText('Create New Story').click();
    await expect(
      page.getByRole('heading', { name: 'How do you want to create your story?' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SEED.generatorName)).toBeVisible();

    // ── 5. Story completion: deterministic seam (no live AI in CI) ──
    await seedCompletedStory({
      parentUid: account.uid,
      childId,
    });

    // Navigate client-side (the kids surfaces crash on a cold deep-link while
    // Firebase auth is still hydrating — known app issue, see docs/testing/e2e.md).
    await page.locator('header a[href="/kids"]').click();
    await expect(page.getByText('Welcome back')).toBeVisible();

    // The completed story shows up in the child's "My Stories" list.
    await page.getByText('My Stories').click();
    await expect(page.getByText(SEED.storyTitle)).toBeVisible({ timeout: 30_000 });

    // Open the story and start making a book from it.
    await page.getByRole('link', { name: 'Read Story' }).click();
    await expect(page.getByRole('heading', { name: SEED.storyTitle })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('link', { name: /create picture book/i }).click();

    // ── 6. Storybook: book type + art style selection ──
    await expect(page.getByRole('heading', { name: 'Choose Your Book Type' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByText(SEED.outputTypeLabel).click();

    await expect(page.getByRole('heading', { name: 'Pick Your Art Style' })).toBeVisible();
    await page.getByText(SEED.imageStyleTitle).click();

    // ── 7. Generation: TEST_MODE drives idle→running→ready via real routes ──
    await page.waitForURL(/\/kids\/create\/.+\/generating\?storybookId=.+/, {
      timeout: 30_000,
    });

    // The page auto-triggers /api/storybookV2/pages then /images and the
    // Firestore status listeners advance the UI; with TEST_MODE fixtures this
    // completes in seconds and auto-redirects to My Books.
    await page.waitForURL('**/kids/books', { timeout: 60_000 });

    // ── 8. Book ready: the finished storybook is listed for the child ──
    await expect(page.getByRole('heading', { name: 'My Books' })).toBeVisible();
    await expect(page.getByText(SEED.storyTitle)).toBeVisible({ timeout: 30_000 });
  });
});
