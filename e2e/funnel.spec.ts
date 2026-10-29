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
 *   story completion (deterministic seam) → choose Form + Style →
 *   POST /api/books → server pipeline → book ready → reader shows pages
 *
 * Determinism notes:
 *  - The Book pipeline (manuscript.paginate, narration, cast sheets, page
 *    art) runs as server jobs on the in-process dispatcher of the e2e server
 *    (JOBS_DISPATCHER unset), with TEST_MODE=1 fixtures instead of AI calls.
 *    The browser only creates the Book and watches it.
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

  test('signup → create child → story → book (Form + Style) → book ready → read', async ({ page }) => {
    test.setTimeout(180_000);

    // ── 1. Signup (creates account + PIN, lands on selector) ──
    // No placeholder child is seeded any more (W1-C); a fresh account sees the
    // first-run prompts: the "Add your first child" empty state and the
    // "Make your first book" onboarding checklist (W2-B).
    account = await signUpNewParent(page, 'funnel');
    await expect(page.getByRole('link', { name: 'Add your first child' })).toBeVisible();
    await expect(page.getByText('Make your first book')).toBeVisible({ timeout: 15_000 });

    // ── 2. Parent creates a child (PIN guard if shown + create dialog) ──
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

    // ── 6. Book: the child picks a Form (book type) and a Style (art style) ──
    await expect(page.getByRole('heading', { name: 'Choose Your Book Type' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByText(SEED.outputTypeLabel).click();

    await expect(page.getByRole('heading', { name: 'Pick Your Art Style' })).toBeVisible();
    await page.getByText(SEED.imageStyleTitle).click();

    // ── 7. POST /api/books → the Book's page; the server makes the book ──
    await page.waitForURL(/\/kids\/book\/bk_[0-9a-f]+$/, { timeout: 30_000 });

    // The page only watches books/{id} and the Manuscript. With TEST_MODE
    // fixtures the jobs finish in seconds and the reader replaces the
    // progress view once the server sets the Book to `ready`.
    const reader = page.getByTestId('book-reader');
    await expect(reader).toBeVisible({ timeout: 90_000 });

    // ── 8. The reader shows the pages: the cover with the title, then words ──
    await expect(reader.getByRole('heading', { name: SEED.storyTitle })).toBeVisible();
    await expect(reader.getByRole('img', { name: SEED.storyTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('book-page-text')).toContainText(/\w+/);
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();

    // ── 9. My Books lists the finished Book with the server's status ──
    await page.getByRole('link', { name: 'Back to My Books' }).click();
    await expect(page.getByRole('heading', { name: 'My Books' })).toBeVisible();
    const card = page.getByTestId('book-card').filter({ hasText: SEED.storyTitle });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute('data-book-status', 'ready');
    await expect(card.getByText('Ready to read')).toBeVisible();
  });
});
