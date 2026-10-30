import { test, expect } from 'playwright/test';
import { SEED, WIZARD_FIXTURE, cleanupFunnelAccount, seedCatalog } from './helpers/emulator';
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
 *   signup → parent creates child → kids mode → choose a creation mode →
 *   play the Story Wizard turn by turn (POST /api/stories, /turns) →
 *   story.finish → Story complete → choose Form + Style → POST /api/books →
 *   server pipeline → book ready → reader shows pages → My Stories / My Books
 *
 * Determinism notes:
 *  - Story creation runs through the real creation routes; with TEST_MODE=1
 *    the wizard engine returns fixture questions (four, three options each)
 *    and a fixture story titled "<child>'s Big Day". `story.finish` and the
 *    Book pipeline run as jobs on the e2e server's in-process dispatcher
 *    (JOBS_DISPATCHER forced to in-process), with fixtures instead of models.
 *  - The browser only creates the Story, sends answers and creates the Book;
 *    it watches the Story, its turns and the Book with read-only listeners.
 *  - Checkout/pay is out of scope (Stripe deferred to sprint WG-1).
 */

const CHILD_NAME = 'Ellie Test';
const STORY_TITLE = WIZARD_FIXTURE.title(CHILD_NAME);

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

  test('signup → create child → play a story → book (Form + Style) → book ready → read', async ({ page }) => {
    test.setTimeout(240_000);

    // ── 1. Signup (creates account + PIN, lands on selector) ──
    // No placeholder child is seeded any more (W1-C); a fresh account sees the
    // first-run prompts: the "Add your first child" empty state and the
    // "Make your first book" onboarding checklist (W2-B).
    account = await signUpNewParent(page, 'funnel');
    await expect(page.getByRole('link', { name: 'Add your first child' })).toBeVisible();
    await expect(page.getByText('Make your first book')).toBeVisible({ timeout: 15_000 });

    // ── 2. Parent creates a child (PIN guard if shown + create dialog) ──
    await createChildViaParentUI(page, account, CHILD_NAME);

    // ── 3. Kids mode: lock to the new child ("who is playing") ──
    await lockKidsModeToChild(page, CHILD_NAME);

    // ── 4. Choose how to make the story (server list: GET /api/creation-modes) ──
    await page.getByText('Create New Story').click();
    await expect(
      page.getByRole('heading', { name: 'How do you want to create your story?' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SEED.secondGeneratorName)).toBeVisible();
    const wizardCard = page.getByTestId('mode-card').filter({ hasText: SEED.generatorName });
    await expect(wizardCard).toBeVisible();
    await wizardCard.click();

    // ── 5. Play: POST /api/stories made the Story; each answer is a turn ──
    await page.waitForURL(/\/kids\/create\/st_[0-9a-f]+$/, { timeout: 30_000 });
    for (let q = 0; q < WIZARD_FIXTURE.questions.length; q++) {
      await expect(page.getByTestId('story-prompt')).toHaveText(WIZARD_FIXTURE.questions[q], { timeout: 30_000 });
      await expect(page.getByTestId('story-progress')).toHaveText(`Step ${q + 1} of ${WIZARD_FIXTURE.questions.length}`);
      const options = page.getByTestId('story-option');
      await expect(options).toHaveCount(3);
      // The options are rendered with names, never cast tokens.
      await expect(options.nth(1)).toContainText(CHILD_NAME);
      await options.first().click();
    }

    // ── 6. Story complete (story.finish on the server) → Form + Style ──
    await expect(page.getByRole('heading', { name: 'Choose Your Book Type' })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForURL(/\/kids\/create\/st_[0-9a-f]+\/style$/);
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
    await expect(reader.getByRole('heading', { name: STORY_TITLE })).toBeVisible();
    await expect(reader.getByRole('img', { name: STORY_TITLE })).toBeVisible();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('book-page-text')).toContainText(CHILD_NAME);
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible();

    // ── 9. My Books lists the finished Book with the server's status ──
    await page.getByRole('link', { name: 'Back to My Books' }).click();
    await expect(page.getByRole('heading', { name: 'My Books' })).toBeVisible();
    const card = page.getByTestId('book-card').filter({ hasText: STORY_TITLE });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute('data-book-status', 'ready');
    await expect(card.getByText('Ready to read')).toBeVisible();

    // ── 10. My Stories lists the Story as ready (GET /api/stories) and reads it ──
    await page.goto('/kids');
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 30_000 });
    await page.getByText('My Stories').click();
    const storyCard = page.getByTestId('story-card').filter({ hasText: STORY_TITLE });
    await expect(storyCard).toBeVisible({ timeout: 30_000 });
    await expect(storyCard).toHaveAttribute('data-story-status', 'complete');
    await storyCard.getByRole('link', { name: 'Read Story' }).click();
    await expect(page.getByRole('heading', { name: STORY_TITLE })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('story-text')).toContainText(CHILD_NAME);
    await expect(page.getByTestId('story-text')).not.toContainText('[[cast:');
  });
});
