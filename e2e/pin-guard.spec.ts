import { test, expect } from 'playwright/test';
import { cleanupFunnelAccount } from './helpers/emulator';
import {
  createChildViaParentUI,
  lockKidsModeToChild,
  passParentPinGuardIfPresent,
  signUpNewParent,
  type ParentAccount,
} from './helpers/flows';

/**
 * Sprint W4-A guard + persona checks (blocking, unlike the report-only probe):
 *
 *  1. Reload grace — a hard reload inside the unexpired 5-minute guard window
 *     must NOT re-prompt for the PIN (fix for probe finding
 *     `pin-guard--grace-lost-on-full-reload`; docs/testing/pin-guard.md §4).
 *  2. Persona cookie — locking the kids PWA to a child sets the signed
 *     httpOnly `storypic.persona` cookie that the generation chokepoints
 *     enforce server-side.
 */

const PERSONA_COOKIE_NAME = 'storypic.persona';

test.describe('PIN guard grace + persona cookie', () => {
  let account: ParentAccount | undefined;

  test.afterEach(async () => {
    if (account) {
      await cleanupFunnelAccount({ uid: account.uid }).catch(() => {});
      account = undefined;
    }
  });

  test('hard reload inside the guard window does not re-prompt for the PIN', async ({ page }) => {
    account = await signUpNewParent(page, 'pin-grace');

    // Reach a guarded page in a validated state (passing the PIN if the
    // fresh-signup grace has somehow lapsed — that validation also restarts
    // the window, so the reload below is always inside it).
    await page.goto('/parent/children');
    const ready = page.getByRole('button', { name: /add new child/i });
    await passParentPinGuardIfPresent(page, account.pin, ready);

    await page.reload();

    // Content must come back WITHOUT the PIN dialog.
    await expect(ready).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Enter Parent PIN')).toHaveCount(0);
  });

  test('locking kids mode to a child sets the signed persona cookie', async ({ page, context }) => {
    account = await signUpNewParent(page, 'persona-cookie');
    await createChildViaParentUI(page, account, 'Cookie Kid');
    await lockKidsModeToChild(page, 'Cookie Kid');

    // The persona sync is fire-and-forget; poll the browser cookie jar.
    await expect
      .poll(
        async () => {
          const cookies = await context.cookies();
          return cookies.find((c) => c.name === PERSONA_COOKIE_NAME)?.value ?? '';
        },
        { timeout: 15_000 },
      )
      .not.toBe('');

    const cookie = (await context.cookies()).find((c) => c.name === PERSONA_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    // Signed format: payload.signature
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
