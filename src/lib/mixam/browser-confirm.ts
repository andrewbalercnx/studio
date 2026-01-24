/**
 * Mixam Browser Automation for Order Confirmation
 *
 * Uses Steel.dev cloud browser service to automate the Mixam web interface
 * for confirming orders. This is a temporary solution until Mixam provides
 * an API endpoint for order confirmation.
 *
 * The confirmation page at https://mixam.co.uk/orders/{orderId} requires:
 * 1. User to be logged in
 * 2. Check the confirmation checkbox
 * 3. Click the "Yes I confirm" button
 */

import Steel from 'steel-sdk';
import puppeteer from 'puppeteer-core';

const MIXAM_BASE_URL = process.env.MIXAM_API_BASE_URL || 'https://mixam.co.uk';
const MIXAM_USERNAME = process.env.MIXAM_USERNAME;
const MIXAM_PASSWORD = process.env.MIXAM_PASSWORD;
const STEEL_API_KEY = process.env.STEEL_API_KEY;

export type MixamConfirmResult = {
  success: boolean;
  message: string;
  screenshots?: {
    beforeConfirm?: string; // Base64 encoded
    afterConfirm?: string; // Base64 encoded
  };
  error?: string;
};

/**
 * Confirms a Mixam order by automating the web interface using Steel cloud browser
 *
 * @param mixamOrderId The Mixam order ID (e.g., "696db6bc4ad5c469938ed5da")
 * @returns Result indicating success or failure
 */
export async function confirmMixamOrder(
  mixamOrderId: string
): Promise<MixamConfirmResult> {
  if (!MIXAM_USERNAME || !MIXAM_PASSWORD) {
    return {
      success: false,
      message: 'Mixam credentials not configured',
      error: 'MIXAM_USERNAME and MIXAM_PASSWORD environment variables must be set',
    };
  }

  if (!STEEL_API_KEY) {
    return {
      success: false,
      message: 'Steel API key not configured',
      error: 'STEEL_API_KEY environment variable must be set',
    };
  }

  let session: any = null;
  let browser: any = null;

  try {
    console.log(`[mixam-browser] Starting Steel browser automation for order ${mixamOrderId}`);

    // Initialize Steel client
    const steel = new Steel({
      steelAPIKey: STEEL_API_KEY,
    });

    // Create a browser session
    console.log('[mixam-browser] Creating Steel session...');
    session = await steel.sessions.create({
      useProxy: false,
      solveCaptcha: true,
    });
    console.log(`[mixam-browser] Steel session created: ${session.id}`);

    // Connect Puppeteer to the Steel session
    console.log('[mixam-browser] Connecting Puppeteer to Steel session...');
    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://connect.steel.dev?apiKey=${STEEL_API_KEY}&sessionId=${session.id}`,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Step 1: Navigate to login page
    console.log('[mixam-browser] Navigating to login page...');
    await page.goto(`${MIXAM_BASE_URL}/login`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Step 2: Log in
    console.log('[mixam-browser] Entering credentials...');

    // Wait for login form
    await page.waitForSelector('input[type="email"], input[name="email"], input[id="email"], #username', {
      timeout: 10000,
    });

    // Find and fill email/username field
    const emailInput = await page.$('input[type="email"]') ||
                       await page.$('input[name="email"]') ||
                       await page.$('input[id="email"]') ||
                       await page.$('#username');

    if (!emailInput) {
      throw new Error('Could not find email/username input field');
    }

    await emailInput.type(MIXAM_USERNAME, { delay: 50 });

    // Find and fill password field
    const passwordInput = await page.$('input[type="password"]');
    if (!passwordInput) {
      throw new Error('Could not find password input field');
    }

    await passwordInput.type(MIXAM_PASSWORD, { delay: 50 });

    // Find and click login button
    const loginButton = await page.$('button[type="submit"]') ||
                        await page.$('input[type="submit"]') ||
                        await page.$('.login-button') ||
                        await page.$('#login-button');

    if (!loginButton) {
      throw new Error('Could not find login button');
    }

    console.log('[mixam-browser] Clicking login button...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      loginButton.click(),
    ]);

    // Check if login was successful
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      const screenshot = await page.screenshot({ encoding: 'base64' });
      return {
        success: false,
        message: 'Login failed - still on login page',
        screenshots: { beforeConfirm: screenshot as string },
        error: 'Login credentials may be incorrect or login form has changed',
      };
    }

    console.log('[mixam-browser] Login successful, navigating to order page...');

    // Step 3: Navigate to order confirmation page
    const orderUrl = `${MIXAM_BASE_URL}/orders/${mixamOrderId}`;
    await page.goto(orderUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Take screenshot before confirmation
    const beforeScreenshot = await page.screenshot({ encoding: 'base64' });

    // Step 4: Look for the confirmation checkbox
    console.log('[mixam-browser] Looking for confirmation checkbox...');

    await page.waitForSelector('body', { timeout: 10000 });

    // Look for checkbox
    const checkboxSelectors = [
      'input[type="checkbox"]',
      '#confirm-checkbox',
      '.confirm-checkbox',
      '[name="confirm"]',
      '[name="agreement"]',
      '[name="terms"]',
    ];

    let checkbox = null;
    for (const selector of checkboxSelectors) {
      checkbox = await page.$(selector);
      if (checkbox) {
        console.log(`[mixam-browser] Found checkbox with selector: ${selector}`);
        break;
      }
    }

    if (!checkbox) {
      const pageContent = await page.content();

      if (pageContent.toLowerCase().includes('confirmed') && !pageContent.toLowerCase().includes('confirm your order')) {
        return {
          success: true,
          message: 'Order appears to already be confirmed',
          screenshots: { beforeConfirm: beforeScreenshot as string },
        };
      }

      return {
        success: false,
        message: 'Could not find confirmation checkbox',
        screenshots: { beforeConfirm: beforeScreenshot as string },
        error: 'The order page structure may have changed or the order is not in a confirmable state',
      };
    }

    // Step 5: Check the checkbox if not already checked
    const isChecked = await checkbox.evaluate((el: HTMLInputElement) => el.checked);
    if (!isChecked) {
      console.log('[mixam-browser] Checking confirmation checkbox...');
      await checkbox.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Step 6: Find and click the confirm button
    console.log('[mixam-browser] Looking for confirm button...');

    let confirmButton = null;

    // Try to find button with text containing "confirm" or "yes"
    const buttons = await page.$$('button, input[type="submit"]');
    for (const button of buttons) {
      const text = await button.evaluate((el: Element) => el.textContent?.toLowerCase() || '');
      if (text.includes('confirm') || text.includes('yes')) {
        confirmButton = button;
        console.log(`[mixam-browser] Found confirm button with text: ${text}`);
        break;
      }
    }

    if (!confirmButton) {
      // Try generic selectors
      confirmButton = await page.$('button[type="submit"]') || await page.$('input[type="submit"]');
    }

    if (!confirmButton) {
      return {
        success: false,
        message: 'Could not find confirm button',
        screenshots: { beforeConfirm: beforeScreenshot as string },
        error: 'The confirmation button could not be located',
      };
    }

    // Step 7: Click the confirm button
    console.log('[mixam-browser] Clicking confirm button...');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
        console.log('[mixam-browser] No navigation after click, checking for AJAX response...');
      }),
      confirmButton.click(),
    ]);

    // Wait for any AJAX responses
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Take screenshot after confirmation
    const afterScreenshot = await page.screenshot({ encoding: 'base64' });

    // Check for success indicators
    const pageContent = await page.content();

    const successIndicators = [
      'order has been confirmed',
      'successfully confirmed',
      'confirmation received',
      'thank you for confirming',
    ];

    const isSuccess = successIndicators.some((indicator) =>
      pageContent.toLowerCase().includes(indicator)
    );

    // Also check if we're no longer seeing the confirmation form
    const stillHasForm = pageContent.toLowerCase().includes('confirm your order') ||
                         pageContent.toLowerCase().includes('do you want to confirm');

    if (isSuccess || !stillHasForm) {
      console.log('[mixam-browser] Order confirmation successful!');
      return {
        success: true,
        message: 'Order confirmed successfully',
        screenshots: {
          beforeConfirm: beforeScreenshot as string,
          afterConfirm: afterScreenshot as string,
        },
      };
    }

    // Check for error indicators
    const errorIndicators = ['error', 'failed', 'invalid', 'problem'];
    const hasError = errorIndicators.some((indicator) =>
      pageContent.toLowerCase().includes(indicator) &&
      !pageContent.toLowerCase().includes('no error')
    );

    if (hasError) {
      return {
        success: false,
        message: 'Confirmation may have failed - error indicators found on page',
        screenshots: {
          beforeConfirm: beforeScreenshot as string,
          afterConfirm: afterScreenshot as string,
        },
        error: 'The page shows error indicators after clicking confirm',
      };
    }

    // Uncertain result - but likely succeeded if form is gone
    return {
      success: true,
      message: 'Order confirmation submitted - please verify on Mixam',
      screenshots: {
        beforeConfirm: beforeScreenshot as string,
        afterConfirm: afterScreenshot as string,
      },
    };

  } catch (error: any) {
    console.error('[mixam-browser] Error during confirmation:', error);
    return {
      success: false,
      message: 'Browser automation failed',
      error: error.message || 'Unknown error',
    };
  } finally {
    // Clean up
    if (browser) {
      console.log('[mixam-browser] Disconnecting browser...');
      await browser.disconnect();
    }
    if (session) {
      console.log('[mixam-browser] Releasing Steel session...');
      try {
        const steel = new Steel({ steelAPIKey: STEEL_API_KEY });
        await steel.sessions.release(session.id);
      } catch (e) {
        console.warn('[mixam-browser] Failed to release session:', e);
      }
    }
  }
}
