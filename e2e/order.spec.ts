import { test, expect } from 'playwright/test';
import { cleanupFunnelAccount, findChildId, grantPrintCredits, SEED, seedCatalog, seedCompleteStory, seedPrintCatalog, seedReadyBook } from './helpers/emulator';
import { createChildViaParentUI, passParentPinGuardIfPresent, signUpNewParent, type ParentAccount } from './helpers/flows';

/**
 * @order — ordering a printed copy (slice 5.6), against the emulator with
 * TEST_MODE on the server (jobs in-process; the print render runs for real on
 * the seeded art; Stripe is the fake gateway).
 *
 *   ready Book → "Order a printed copy" → format, copies, address →
 *   POST /api/orders (the order's own render; the Book is locked) →
 *   order page: waiting for payment → pay with print credits → paid, being
 *   checked (approval is on by default) → listed on the parent's orders page
 *
 * The card path ends at Stripe's hosted page, so it is covered by the order
 * service tests (fake gateway and webhook); here we only see the button.
 */
const CHILD_NAME = 'Olly Order';

test.describe('order a printed copy @order', () => {
  let account: ParentAccount | undefined;

  test.beforeAll(async () => {
    await seedCatalog();
    await seedPrintCatalog();
  });

  test.afterEach(async () => {
    if (account) {
      await cleanupFunnelAccount({ uid: account.uid });
      account = undefined;
    }
  });

  test('ready book → order → pay with print credits → paid', async ({ page }) => {
    test.setTimeout(180_000);
    account = await signUpNewParent(page, 'order');
    await createChildViaParentUI(page, account, CHILD_NAME);
    const childId = await findChildId(account.uid, CHILD_NAME);
    const { storyId } = await seedCompleteStory({ ownerUid: account.uid, childId });
    const { bookId } = await seedReadyBook({ storyId });
    await grantPrintCredits(account.uid, 2);

    // ── 1. The Book page offers printing once the pictures are finished ──
    await page.goto(`/books/${bookId}`);
    const orderLink = page.getByRole('link', { name: 'Order a printed copy' });
    await expect(orderLink).toBeVisible({ timeout: 30_000 });
    await orderLink.click();

    // ── 2. Format (with its page count and price), copies, address ──
    await page.waitForURL(new RegExp(`/books/${bookId}/order$`));
    const format = page.getByRole('radio', { name: new RegExp(SEED.printLayoutName) });
    await expect(format).toBeVisible({ timeout: 30_000 });
    await expect(format).toContainText('8 pages');
    await expect(format).toContainText('£19.99');
    await format.click();
    await page.getByLabel('Name', { exact: true }).fill('Olly Parent');
    await page.getByLabel('Address', { exact: true }).fill('1 High Street');
    await page.getByLabel('Town or city').fill('London');
    await page.getByLabel('Postcode').fill('SW1A 1AA');
    await expect(page.getByLabel('Email for order updates')).toHaveValue(account.email);
    await page.getByRole('button', { name: 'Place order' }).click();
    await passParentPinGuardIfPresent(page, account.pin, page.getByText('Printed book order'));

    // ── 3. The order page: print files made, then waiting for payment ──
    await page.waitForURL(/\/orders\/po_[0-9a-f]+$/, { timeout: 30_000 });
    await expect(page.getByText('Waiting for payment').first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('link', { name: /Pages \(PDF\)/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay £19.99 by card' })).toBeVisible();

    // ── 4. Pay with print credits → paid, waiting for an admin (approval on) ──
    await page.getByRole('button', { name: /Use 1 print credit \(2 left\)/ }).click();
    await passParentPinGuardIfPresent(page, account.pin, page.getByText('Paid, being checked').first());
    await expect(page.getByText('Paid, being checked').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Pay .* by card/ })).toHaveCount(0);

    // ── 5. The parent's orders list shows it ──
    await page.goto('/parent/orders');
    await passParentPinGuardIfPresent(page, account.pin, page.getByRole('heading', { name: 'Printed book orders' }));
    await expect(page.getByRole('link', { name: /1 copy · £19\.99/ })).toBeVisible({ timeout: 30_000 });
  });
});
