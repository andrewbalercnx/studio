import { test, expect } from 'playwright/test';
import { cleanupFunnelAccount, findChildId, seedCatalog } from './helpers/emulator';
import { createChildViaParentUI, passParentPinGuardIfPresent, signUpNewParent, type ParentAccount } from './helpers/flows';

/**
 * @characters — a child's likeness (slice 5.7), against the emulator with
 * TEST_MODE on the server (likeness jobs run in-process and write fixtures).
 *
 *   add a child without photos → an "imagined" avatar drawn from the
 *   description → add a photo → appearance and portrait ready → the avatar
 *   is redrawn from the portrait (no longer "imagined")
 *
 * Every step goes through `/api/children/**`: the browser no longer writes
 * child documents (the rules refuse it).
 */
const CHILD_NAME = 'Pia Portrait';

// Minimal 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==', 'base64');

test.describe('child likeness @characters', () => {
  let account: ParentAccount | undefined;

  test.beforeAll(async () => {
    await seedCatalog();
  });

  test.afterEach(async () => {
    if (account) {
      await cleanupFunnelAccount({ uid: account.uid });
      account = undefined;
    }
  });

  test('imagined avatar → photo → appearance, portrait and a new avatar', async ({ page }) => {
    test.setTimeout(120_000);
    account = await signUpNewParent(page, 'likeness');
    await createChildViaParentUI(page, account, CHILD_NAME);
    const childId = await findChildId(account.uid, CHILD_NAME);

    // ── 1. No photos yet: the avatar is imagined from the description ──
    await page.locator(`[data-wiz-target="child-photos-${childId}"]`).click();
    const panel = page.getByRole('dialog').getByTestId('likeness-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('likeness-avatar')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('likeness-imagined')).toBeVisible();
    await expect(panel.getByText('No photos yet')).toBeVisible();

    // ── 2. A photo: appearance and portrait come from it, then a new avatar from the portrait ──
    await panel.getByTestId('likeness-photo-input').setInputFiles({ name: 'pia.png', mimeType: 'image/png', buffer: PNG });
    await expect(panel.getByAltText('Photo 1')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('likeness-appearance')).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByTestId('likeness-portrait')).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByTestId('likeness-imagined')).toBeHidden({ timeout: 45_000 });
    await expect(panel.getByTestId('likeness-avatar')).toBeVisible();

    // ── 3. After a reload the server still has it all (read back through the route) ──
    // (Under the emulator the stored URLs point at production Storage, so we check the
    // elements, not that the image bytes load.)
    await page.keyboard.press('Escape');
    await page.reload();
    const photos = page.locator(`[data-wiz-target="child-photos-${childId}"]`);
    await passParentPinGuardIfPresent(page, account.pin, photos);
    await photos.click();
    const again = page.getByRole('dialog').getByTestId('likeness-panel');
    await expect(again.getByTestId('likeness-avatar')).toBeVisible({ timeout: 30_000 });
    await expect(again.getByTestId('likeness-portrait')).toBeVisible();
    await expect(again.getByAltText('Photo 1')).toBeVisible();
    await expect(again.getByTestId('likeness-imagined')).toBeHidden();
  });
});
