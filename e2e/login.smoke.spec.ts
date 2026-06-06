import { test, expect } from 'playwright/test';

/**
 * Smoke: the login page loads and exposes a "Sign In" affordance.
 *
 * This is the minimal foundation check for Sprint 3A — it proves the Playwright
 * harness boots, navigates against baseURL, and asserts on user-visible state
 * (no waitForTimeout, web-first assertions only).
 */
test('login page shows the Sign In affordance', async ({ page }) => {
  await page.goto('/login');

  // The submit button renders "Sign In" (and "Signing In..." while pending).
  const signIn = page.getByRole('button', { name: /sign in/i });
  await expect(signIn).toBeVisible();
});
