/**
 * Reusable UI flows for the E2E suite. Web-first assertions only — no
 * waitForTimeout (banned, see docs/testing/e2e.md).
 */
import { expect, type Page } from 'playwright/test';
import { E2E_PASSWORD, E2E_PIN, uniqueEmail } from './test-env';
import { findUidByEmail } from './emulator';

export type ParentAccount = {
  email: string;
  password: string;
  pin: string;
  uid: string;
};

/**
 * Drive the real signup UI: creates the auth user, the users/{uid} profile,
 * the default child ("My First Child") and sets the parent PIN, then lands on
 * the "Who is playing?" page. Returns the new account incl. its emulator uid.
 */
export async function signUpNewParent(page: Page, tag: string): Promise<ParentAccount> {
  const email = uniqueEmail(tag);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel('4-Digit Parent PIN').fill(E2E_PIN);
  await page.getByLabel('Confirm PIN').fill(E2E_PIN);
  await page.getByRole('button', { name: 'Sign Up' }).click();

  // Post-signup landing: the parent-mode "Who is playing?" selector. Race the
  // failure toast so a signup error reports its actual message instead of a
  // bare timeout (seen rarely under heavy local test parallelism).
  const whoIsPlaying = page.getByText('Who is playing?');
  const failureToast = page.getByText('Sign-up failed');
  await expect(whoIsPlaying.or(failureToast).first()).toBeVisible({ timeout: 30_000 });
  if (await failureToast.isVisible()) {
    const toastText = await page.getByRole('region', { name: /notifications/i }).innerText();
    throw new Error(`Signup failed for ${email}: ${toastText.replace(/\s+/g, ' ').trim()}`);
  }

  const uid = await findUidByEmail(email);
  return { email, password: E2E_PASSWORD, pin: E2E_PIN, uid };
}

/**
 * Complete the parent PIN guard modal if/when it appears.
 *
 * Since the fresh-PIN grace (515c81b) the modal does NOT appear within the
 * guard window right after signup, so the dialog is optional.
 */
export async function passParentPinGuard(page: Page, pin: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  const pinPrompt = dialog.getByText('Enter Parent PIN');
  try {
    await expect(pinPrompt).toBeVisible({ timeout: 5_000 });
  } catch {
    // Guard window still open (fresh-PIN grace) — no modal to pass.
    return;
  }
  await dialog.locator('input[type="password"]').fill(pin);
  await dialog.getByRole('button', { name: /unlock|verify|confirm|submit/i }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/**
 * Create a child through the parent console UI (PIN guard included).
 * Leaves the browser on /parent/children with the new child visible.
 */
export async function createChildViaParentUI(
  page: Page,
  account: ParentAccount,
  childName: string,
): Promise<void> {
  await page.goto('/parent/children');
  await passParentPinGuard(page, account.pin);

  await page.getByRole('button', { name: /add new child/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Create New Child Profile')).toBeVisible();
  await dialog.getByPlaceholder('Child name').fill(childName);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await expect(page.getByText(childName).first()).toBeVisible();
}

/**
 * Lock the kids PWA to a child via the "Choose Who's Playing" setup screen.
 * Ends on the kids home dashboard for that child.
 */
export async function lockKidsModeToChild(page: Page, childName: string): Promise<void> {
  await page.goto('/kids/setup');
  await expect(
    page.getByRole('heading', { name: /choose who['’]s playing|switch profile/i }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: new RegExp(childName, 'i') }).click();

  // Kids home for the locked child.
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: childName })).toBeVisible();
}
