import { test, expect, type Page } from 'playwright/test';
import { cleanupAdminUser, createAdminUser, emulatorFirestore } from './helpers/emulator';

/**
 * @admin — the admin and writer pages split in slice 6.4b open as before, and
 * a config change goes through /api/admin/catalog/** (slice 6.4a): an admin
 * saves a story phase on the writer page and it is stored.
 */
const PASSWORD = 'e2e-admin-Passw0rd!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/\/admin/, { timeout: 30_000 });
}

test.describe('admin and writer pages @admin', () => {
  let admin: { email: string; uid: string } | undefined;
  const phaseName = `E2E phase ${Date.now()}`;

  test.beforeAll(async () => {
    admin = await createAdminUser('pages', PASSWORD);
  });

  test.afterAll(async () => {
    if (admin) await cleanupAdminUser(admin.uid, phaseName);
  });

  test('the split pages open, and a story phase saves through the catalog route', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, admin!.email);

    const pages: Array<[string, string | RegExp]> = [
      ['/admin/storyTypes', 'Story Types'],
      ['/admin/storyGenerators', 'Story Generators'],
      ['/admin/print-layouts', 'Print Layouts'],
      ['/admin/print-products', 'Print Products'],
      ['/admin/regression', 'Regression Test Dashboard'],
    ];
    for (const [path, title] of pages) {
      await page.goto(path);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    }

    await page.goto('/writer');
    await page.getByRole('tab', { name: 'Story Phases' }).click();
    await page.getByRole('button', { name: 'New Phase' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill(phaseName);
    await dialog.getByRole('button', { name: 'Save Phase' }).click();
    await expect(page.getByRole('cell', { name: phaseName })).toBeVisible({ timeout: 30_000 });

    const stored = await emulatorFirestore().collection('storyPhases').where('name', '==', phaseName).get();
    expect(stored.size).toBe(1);
    expect(stored.docs[0].data().createdAt).toBeTruthy();
  });
});
