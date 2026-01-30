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
    console.log(`[mixam-browser] Using credentials - Username: ${MIXAM_USERNAME}, Password: ${'*'.repeat(MIXAM_PASSWORD.length)} (${MIXAM_PASSWORD.length} chars)`);

    // Initialize Steel client
    const steel = new Steel({
      steelAPIKey: STEEL_API_KEY,
    });

    // Create a browser session
    console.log('[mixam-browser] Creating Steel session...');
    session = await steel.sessions.create({
      useProxy: false,
      solveCaptcha: false, // Requires paid plan
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

    // Step 1.5: Accept any popup dialogs (Terms & Conditions, Cookie consent)
    // These must be ACCEPTED (not just hidden) for the server to recognize the acceptance
    console.log('[mixam-browser] Checking for popup dialogs to accept...');

    // First, log detailed button info including full data attributes
    const buttonInfo = await page.evaluate(() => {
      const termsBtn = document.querySelector('#acceptTerms') as HTMLButtonElement;
      const cookiesBtn = document.querySelector('#acceptAllCookies') as HTMLButtonElement;

      // Get parent dialog container HTML
      const getDialogHTML = (btn: HTMLElement | null) => {
        if (!btn) return null;
        // Find the toast/alert container
        let container = btn.closest('.toast, .alert, [class*="banner"], [class*="notice"], .fixed-bottom');
        if (!container) {
          // Go up a few levels
          container = btn.parentElement?.parentElement?.parentElement || null;
        }
        return container?.outerHTML?.substring(0, 500);
      };

      return {
        terms: termsBtn ? {
          tagName: termsBtn.tagName,
          type: termsBtn.type,
          id: termsBtn.id,
          className: termsBtn.className,
          dataAction: termsBtn.getAttribute('data-action'), // Full data-action value
          allDataAttrs: Object.fromEntries(
            Array.from(termsBtn.attributes)
              .filter(a => a.name.startsWith('data-'))
              .map(a => [a.name, a.value])
          ),
          dialogHTML: getDialogHTML(termsBtn),
        } : null,
        cookies: cookiesBtn ? {
          tagName: cookiesBtn.tagName,
          type: cookiesBtn.type,
          id: cookiesBtn.id,
          dataAction: cookiesBtn.getAttribute('data-action'),
          allDataAttrs: Object.fromEntries(
            Array.from(cookiesBtn.attributes)
              .filter(a => a.name.startsWith('data-'))
              .map(a => [a.name, a.value])
          ),
        } : null,
      };
    });
    console.log(`[mixam-browser] Button info: ${JSON.stringify(buttonInfo)}`);

    // Take screenshot before clicking
    const preClickScreenshot = await page.screenshot({ encoding: 'base64' });
    console.log('[mixam-browser] Pre-click screenshot captured');

    // Try clicking with actual mouse coordinates (more realistic click)
    const termsButton = await page.$('#acceptTerms');
    if (termsButton) {
      console.log('[mixam-browser] Clicking Terms Accept with mouse coordinates...');
      const box = await termsButton.boundingBox();
      if (box) {
        const clickX = box.x + box.width / 2;
        const clickY = box.y + box.height / 2;

        // Log what element is at those coordinates before clicking
        const elementAtPoint = await page.evaluate((x: number, y: number) => {
          const el = document.elementFromPoint(x, y);
          return el ? {
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            textContent: el.textContent?.substring(0, 50),
          } : null;
        }, clickX, clickY);
        console.log(`[mixam-browser] Element at click point (${clickX}, ${clickY}): ${JSON.stringify(elementAtPoint)}`);

        // Click in the center of the button
        await page.mouse.click(clickX, clickY);
        console.log(`[mixam-browser] Mouse clicked at (${clickX}, ${clickY})`);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Take screenshot after clicking
        const postClickScreenshot = await page.screenshot({ encoding: 'base64' });
        console.log('[mixam-browser] Post-click screenshot captured');
      }
    }

    // Check if Terms dialog is gone, then do cookies
    let termsStillThere = await page.$('#acceptTerms');
    if (termsStillThere) {
      console.log('[mixam-browser] Terms still there after mouse click');

      // Log the dialog state after click
      const dialogStateAfter = await page.evaluate(() => {
        const termsBtn = document.querySelector('#acceptTerms') as HTMLElement;
        if (!termsBtn) return null;
        const container = termsBtn.closest('.toast, .alert, [class*="banner"]') ||
                          termsBtn.parentElement?.parentElement?.parentElement;
        return {
          containerDisplay: container ? window.getComputedStyle(container).display : null,
          containerVisibility: container ? window.getComputedStyle(container).visibility : null,
          buttonDisabled: (termsBtn as HTMLButtonElement).disabled,
        };
      });
      console.log(`[mixam-browser] Dialog state after click: ${JSON.stringify(dialogStateAfter)}`);
    }

    const cookiesButton = await page.$('#acceptAllCookies');
    if (cookiesButton) {
      console.log('[mixam-browser] Clicking Cookies Accept with mouse coordinates...');
      const box = await cookiesButton.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`[mixam-browser] Mouse clicked at (${box.x + box.width / 2}, ${box.y + box.height / 2})`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Log cookies after acceptance attempts
    const cookies = await page.cookies();
    console.log(`[mixam-browser] All cookies: ${JSON.stringify(cookies.map((c: { name: string; value: string }) => c.name))}`);

    // Verify dialogs are gone
    const termsStillVisible = await page.$('#acceptTerms');
    const cookiesStillVisible = await page.$('#acceptAllCookies');
    console.log(`[mixam-browser] Dialogs dismissed - Terms: ${!termsStillVisible}, Cookies: ${!cookiesStillVisible}`);

    // Log the entire DOM for debugging (compressed to single line)
    const bodyHTML = await page.$eval('body', (body: Element) => body.innerHTML.replace(/\s+/g, ' ').substring(0, 5000));
    console.log(`[mixam-browser] DOM (first 5000 chars): ${bodyHTML}`);

    // Step 2: Log in
    console.log('[mixam-browser] Entering credentials...');

    // Wait for login form's password field specifically (more reliable than generic selectors)
    await page.waitForSelector('input[type="password"]', {
      timeout: 10000,
    });

    // Log what inputs we find for debugging
    const allInputs = await page.$$eval('input', (inputs: HTMLInputElement[]) =>
      inputs.map((i: HTMLInputElement) => ({
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
      }))
    );
    console.log('[mixam-browser] Found inputs:', JSON.stringify(allInputs));

    // Find the password field first (more unique than email/text fields)
    const passwordInput = await page.$('input[type="password"]');
    if (!passwordInput) {
      throw new Error('Could not find password input field');
    }
    console.log('[mixam-browser] Found password input');

    // Find email field - look for input[type="email"] or text input near password field
    // The login form should have an email field before the password field
    let emailInput = await page.$('input[type="email"]');

    // If not type="email", try to find the text input that's part of the login form
    // by looking for inputs near the password field (in the same form/container)
    if (!emailInput) {
      // Try to find the form containing the password field and get its email input
      const formInputs = await page.$$eval('form input[type="text"], form input[type="email"]', (inputs: HTMLInputElement[]) =>
        inputs.map((i, idx) => ({
          idx,
          type: i.type,
          placeholder: i.placeholder,
          isSearch: i.placeholder?.toLowerCase().includes('search'),
        }))
      );
      console.log('[mixam-browser] Form inputs found:', JSON.stringify(formInputs));

      // Find a non-search text input
      const nonSearchInputs = formInputs.filter((i: { isSearch: boolean }) => !i.isSearch);
      if (nonSearchInputs.length > 0) {
        const formTextInputs = await page.$$('form input[type="text"], form input[type="email"]');
        for (let i = 0; i < formTextInputs.length; i++) {
          const placeholder = await formTextInputs[i].evaluate((el: HTMLInputElement) => el.placeholder);
          if (!placeholder?.toLowerCase().includes('search')) {
            emailInput = formTextInputs[i];
            break;
          }
        }
      }
    }

    if (!emailInput) {
      throw new Error('Could not find email/username input field');
    }

    // Click to focus the email input first
    console.log('[mixam-browser] Clicking email input to focus...');
    await emailInput.click();
    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log('[mixam-browser] Typing username...');
    await emailInput.type(MIXAM_USERNAME, { delay: 50 });

    // Click to focus password input
    console.log('[mixam-browser] Clicking password input to focus...');
    await passwordInput.click();
    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log('[mixam-browser] Typing password...');
    await passwordInput.type(MIXAM_PASSWORD, { delay: 50 });

    // Take screenshot before submitting login for debugging
    const preLoginScreenshot = await page.screenshot({ encoding: 'base64' });
    console.log('[mixam-browser] Pre-login screenshot captured');

    // Log what's actually in the form fields before submission
    const fieldValues = await page.evaluate(() => {
      const emailField = document.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordField = document.querySelector('input[type="password"]') as HTMLInputElement;
      return {
        emailValue: emailField?.value || '(not found)',
        emailLength: emailField?.value?.length || 0,
        passwordLength: passwordField?.value?.length || 0,
        hasEmail: !!emailField,
        hasPassword: !!passwordField,
      };
    });
    console.log(`[mixam-browser] Field values before submit: ${JSON.stringify(fieldValues)}`);

    // Submit the form - try multiple approaches
    console.log('[mixam-browser] Submitting login form...');

    // First, try to find and submit the form directly
    const formSubmitted = await page.evaluate(() => {
      const passwordField = document.querySelector('input[type="password"]');
      if (passwordField) {
        const form = passwordField.closest('form');
        if (form) {
          // Dispatch submit event
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          const eventHandled = !form.dispatchEvent(submitEvent);
          if (!eventHandled) {
            // If not prevented, also call submit()
            form.submit();
          }
          return { method: 'form.submit', formAction: form.action };
        }
      }
      return { method: 'none' };
    });

    console.log(`[mixam-browser] Form submission: ${JSON.stringify(formSubmitted)}`);

    // Also press Enter as backup
    await passwordInput.press('Enter');

    // Wait for either navigation to complete or for the page to settle
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {
        console.log('[mixam-browser] No navigation event, checking page state...');
      }),
      new Promise((resolve) => setTimeout(resolve, 5000)), // Fallback: wait 5 seconds
    ]);

    // Additional wait for any AJAX to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if login was successful by looking at the current URL
    const currentUrl = page.url();
    console.log(`[mixam-browser] Current URL after login attempt: ${currentUrl}`);

    if (currentUrl.includes('/login')) {
      // Check for error messages on the page
      const errorInfo = await page.evaluate(() => {
        // Look for common error message patterns
        const errorSelectors = [
          '.alert-danger',
          '.error-message',
          '.invalid-feedback',
          '[class*="error"]',
          '[class*="alert"]',
        ];

        for (const selector of errorSelectors) {
          const el = document.querySelector(selector);
          if (el && el.textContent?.trim()) {
            return { found: true, text: el.textContent.trim(), selector };
          }
        }

        // Check page content for error keywords
        const bodyText = document.body.innerText.toLowerCase();
        const hasInvalid = bodyText.includes('invalid');
        const hasIncorrect = bodyText.includes('incorrect');
        const hasWrongPassword = bodyText.includes('wrong password');

        return {
          found: hasInvalid || hasIncorrect || hasWrongPassword,
          text: hasInvalid ? 'invalid' : hasIncorrect ? 'incorrect' : hasWrongPassword ? 'wrong password' : 'none',
          selector: 'body text search',
        };
      });

      console.log(`[mixam-browser] Error detection result: ${JSON.stringify(errorInfo)}`);

      const postLoginScreenshot = await page.screenshot({ encoding: 'base64' });
      return {
        success: false,
        message: errorInfo.found ? `Login failed - ${errorInfo.text}` : 'Login failed - still on login page',
        screenshots: {
          beforeConfirm: preLoginScreenshot as string,
          afterConfirm: postLoginScreenshot as string,
        },
        error: 'Login credentials may be incorrect or login form has changed',
      };
    }

    console.log('[mixam-browser] Login appears successful, navigating to order page...');

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
