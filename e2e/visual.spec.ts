import { test, expect } from 'playwright/test';
import { cleanupFunnelAccount, seedCatalog } from './helpers/emulator';
import {
  createChildViaParentUI,
  lockKidsModeToChild,
  signUpNewParent,
  type ParentAccount,
} from './helpers/flows';

/**
 * @visual — screenshot regression of key surfaces.
 *
 * REPORT-ONLY: runs under continue-on-error in CI. Baselines are committed per
 * project+platform under e2e/__screenshots__/ (snapshotPathTemplate in
 * playwright.config.ts). A platform's first run fails with "snapshot missing"
 * and writes the candidate baseline — download it from the CI artifact, commit
 * it, and subsequent runs compare against it. Promotion criterion in
 * docs/testing/e2e.md.
 *
 * Dynamic regions (avatars are seeded from picsum.photos and differ per
 * account) are masked so the diff only sees stable chrome.
 */

test.describe('visual regression @visual', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('signup page', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: 'Sign Up' })).toBeVisible();
    await expect(page).toHaveScreenshot('signup.png', { fullPage: true });
  });

  test.describe('authenticated surfaces', () => {
    let account: ParentAccount | undefined;

    test.afterEach(async () => {
      if (account) {
        await cleanupFunnelAccount({ uid: account.uid });
        account = undefined;
      }
    });

    test('kids home', async ({ page }) => {
      await seedCatalog();
      account = await signUpNewParent(page, 'visual-kids');
      // Signup no longer seeds a placeholder child (W1-C). Create the child
      // through the UI with the same display name the committed kids-home
      // baselines were captured with, so they remain valid.
      await createChildViaParentUI(page, account, 'My First Child');
      await lockKidsModeToChild(page, 'My First Child');

      await expect(page.getByText('Create New Story')).toBeVisible();
      await expect(page).toHaveScreenshot('kids-home.png', {
        fullPage: true,
        // Mask the avatar (remote picsum image, varies per child id).
        mask: [page.locator('img[alt="My First Child"]'), page.locator('span:has(> img)')],
      });
    });
  });
});
