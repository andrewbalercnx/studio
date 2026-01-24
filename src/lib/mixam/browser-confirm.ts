/**
 * Mixam Browser Automation for Order Confirmation
 *
 * TEMPORARY SOLUTION: This uses Puppeteer to automate the Mixam web interface
 * for confirming orders. This should be replaced with an API call once Mixam
 * provides a confirmation endpoint.
 *
 * The confirmation page at https://mixam.co.uk/orders/{orderId} requires:
 * 1. User to be logged in
 * 2. Check the confirmation checkbox
 * 3. Click the "Yes I confirm" button
 */

import puppeteer, { Browser, Page } from 'puppeteer';

const MIXAM_BASE_URL = process.env.MIXAM_API_BASE_URL || 'https://mixam.co.uk';
const MIXAM_USERNAME = process.env.MIXAM_USERNAME;
const MIXAM_PASSWORD = process.env.MIXAM_PASSWORD;

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
 * Confirms a Mixam order by automating the web interface
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

  let browser: Browser | null = null;

  try {
    console.log(`[mixam-browser] Starting browser automation for order ${mixamOrderId}`);

    // Launch browser in headless mode
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Set a reasonable viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Set user agent to avoid bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

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

    // Check if login was successful (should not be on login page anymore)
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Take screenshot for debugging
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

    // Step 4: Check if the confirmation checkbox exists
    console.log('[mixam-browser] Looking for confirmation checkbox...');

    // Wait for page content to load
    await page.waitForSelector('body', { timeout: 10000 });

    // Look for the confirmation checkbox - try various selectors
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
      // Page might already be confirmed or in different state
      const pageContent = await page.content();

      if (pageContent.includes('confirmed') || pageContent.includes('Confirmed')) {
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
    const isChecked = await checkbox.evaluate((el) => (el as HTMLInputElement).checked);
    if (!isChecked) {
      console.log('[mixam-browser] Checking confirmation checkbox...');
      await checkbox.click();
      await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay after checking
    }

    // Step 6: Find and click the confirm button
    console.log('[mixam-browser] Looking for confirm button...');

    const buttonSelectors = [
      'button:contains("confirm")',
      'button:contains("Confirm")',
      'button:contains("Yes")',
      '.confirm-button',
      '#confirm-button',
      'button[type="submit"]',
      'input[type="submit"]',
    ];

    let confirmButton = null;

    // Try to find button with text containing "confirm" or "yes"
    const buttons = await page.$$('button, input[type="submit"]');
    for (const button of buttons) {
      const text = await button.evaluate((el) => el.textContent?.toLowerCase() || '');
      if (text.includes('confirm') || text.includes('yes')) {
        confirmButton = button;
        console.log(`[mixam-browser] Found confirm button with text: ${text}`);
        break;
      }
    }

    if (!confirmButton) {
      // Try generic selectors
      for (const selector of buttonSelectors) {
        try {
          confirmButton = await page.$(selector);
          if (confirmButton) break;
        } catch {
          // Selector might not be valid, continue
        }
      }
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
        // Navigation might not happen if it's an AJAX request
        console.log('[mixam-browser] No navigation after click, checking for AJAX response...');
      }),
      confirmButton.click(),
    ]);

    // Wait a moment for any AJAX responses
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Take screenshot after confirmation
    const afterScreenshot = await page.screenshot({ encoding: 'base64' });

    // Check for success indicators
    const pageContent = await page.content();
    const pageUrl = page.url();

    // Look for success indicators
    const successIndicators = [
      'confirmed',
      'Confirmed',
      'success',
      'Success',
      'thank you',
      'Thank you',
      'order has been confirmed',
    ];

    const isSuccess = successIndicators.some((indicator) =>
      pageContent.includes(indicator)
    );

    if (isSuccess) {
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
    const errorIndicators = ['error', 'Error', 'failed', 'Failed', 'invalid', 'Invalid'];
    const hasError = errorIndicators.some((indicator) =>
      pageContent.includes(indicator)
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

    // Uncertain result
    return {
      success: false,
      message: 'Confirmation status uncertain - please verify manually',
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
    if (browser) {
      console.log('[mixam-browser] Closing browser...');
      await browser.close();
    }
  }
}
