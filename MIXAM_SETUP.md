# Mixam Print-on-Demand Setup Guide

## Overview

This guide explains how to configure the Mixam integration for print-on-demand services. The integration supports JWT-based authentication and can operate in mock mode for testing without API access.

## Environment Variables

Add these variables to your `.env` file at the root of your project (`/home/user/studio/.env`):

```bash
# ==================================================
# MIXAM PRINT-ON-DEMAND CONFIGURATION
# ==================================================

# Mock Mode - Set to true for testing without Mixam API
# When true, all API calls return mock data
# Set to false when you have real Mixam credentials
MIXAM_MOCK_MODE=true

# Mixam API Credentials
# These are your Mixam account username and password
# Used to generate JWT tokens for API authentication
MIXAM_USERNAME=your_mixam_username_here
MIXAM_PASSWORD=your_mixam_password_here

# Mixam API Base URL (optional - uses default if not set)
# Default: https://api.mixam.com
MIXAM_API_BASE_URL=https://api.mixam.com

# Mixam Shop Name (optional)
# Your shop identifier in Mixam's system
MIXAM_SHOP_NAME=studio-storybooks

# Webhook Secret (for verifying Mixam webhook signatures)
# Mixam will provide this when you configure webhooks
MIXAM_WEBHOOK_SECRET=your_webhook_secret_here

# Admin Notification UID
# Firebase UID of the admin user who receives order notifications
ADMIN_NOTIFICATION_UID=your_admin_firebase_uid
```

## Authentication Method

### JWT Token Flow

Mixam uses JWT (JSON Web Token) authentication as documented at:
https://mixam.co.uk/documentation/api/public#security

**How it works:**

1. **Generate Token:**
   - POST to `/token` with Basic Auth (username:password)
   - Mixam returns a JWT token

2. **Cache Token:**
   - The token is cached and reused until it expires
   - Token lifespan is decoded from the JWT payload
   - Tokens are automatically refreshed 5 minutes before expiry

3. **Use Token:**
   - All subsequent API calls use: `Authorization: Bearer <jwt_token>`
   - Token is included in the header for file uploads, order submissions, etc.

**Implementation:**
- See `src/lib/mixam/client.ts` lines 42-121
- Token caching prevents unnecessary authentication requests
- Automatic token refresh ensures uninterrupted service

## Mock Mode

### Purpose

Mock mode allows you to:
- Test the entire order workflow without Mixam API access
- Develop and QA features before API approval
- Demo the system to stakeholders
- Run automated tests

### How It Works

When `MIXAM_MOCK_MODE=true`:
- All Mixam API calls return realistic fake data
- No actual HTTP requests are made to Mixam
- Logs indicate mock operations with `[MIXAM MOCK]` prefix
- Order submission simulates webhook responses

### Testing Workflow in Mock Mode

1. **Seed Product:**
   - Go to `/admin`
   - Click "Seed Hardcover Product"

2. **Create Story:**
   - Create a story and generate printable PDFs
   - Ensure story has both cover and interior PDFs

3. **Place Order:**
   - Navigate to `/storybook/[bookId]/order`
   - Select product, quantity, and customization
   - Enter UK shipping address
   - Submit order

4. **Admin Review:**
   - Go to `/admin/print-orders`
   - Review order details, validation results
   - Approve order

5. **Submit to Mixam (Mock):**
   - Click "Submit to Mixam"
   - Mock response will show fake job number
   - Check console logs for mock operations

## Switching to Real Mixam API

### Prerequisites

1. **Mixam Account:**
   - Create account at https://mixam.co.uk
   - Complete business verification
   - Get API access approval from Mixam

2. **Credentials:**
   - Your Mixam username
   - Your Mixam password
   - Webhook secret (from Mixam webhook configuration)

### Steps to Enable

1. **Update `.env` file:**
   ```bash
   # Switch mock mode OFF
   MIXAM_MOCK_MODE=false

   # Add your real credentials
   MIXAM_USERNAME=your_real_username
   MIXAM_PASSWORD=your_real_password
   MIXAM_WEBHOOK_SECRET=your_webhook_secret
   ```

2. **Restart Server:**
   ```bash
   npm run dev
   ```

3. **Test Authentication:**
   - Place a test order
   - Check logs for `[Mixam] JWT token obtained and cached`
   - Should NOT see `[MIXAM MOCK]` in logs

4. **Configure Webhooks:**
   - In Mixam dashboard, set webhook URL to:
   - `https://your-domain.com/api/webhooks/mixam`
   - Ensure webhook secret matches `.env` value

## API Endpoints Used

### Authentication
```
POST /token
Authorization: Basic {base64(username:password)}
Returns: { token: "jwt_token_here" }
```

### File Upload
```
POST /api/public/files
Authorization: Bearer {jwt_token}
Body: FormData with PDF file and MD5 checksum
Returns: { fileId: "...", url: "...", checksum: "..." }
```

### Order Submission
```
POST /api/public/orders
Authorization: Bearer {jwt_token}
Body: MxJdf v4.01.05 JSON document
Returns: { orderId: "...", jobNumber: "...", status: "..." }
```

### Order Status
```
GET /api/public/user/orders/{orderId}
Authorization: Bearer {jwt_token}
Returns: { status: "...", trackingUrl: "...", estimatedDelivery: "..." }
```

## Security Considerations

### JWT Token Storage

- Tokens are stored in memory (not persistent storage)
- Each server instance maintains its own token cache
- Tokens expire automatically and are refreshed as needed
- No sensitive credentials are logged

### Webhook Verification

- All webhook requests are verified using HMAC-SHA256
- Webhook secret must match between Mixam and your `.env`
- Invalid signatures are rejected with 401 status
- See `src/app/api/webhooks/mixam/route.ts` for implementation

### Environment Variable Security

**IMPORTANT:** Never commit `.env` file to version control!

- `.env` should be in `.gitignore`
- Use environment-specific configuration
- Rotate credentials periodically
- Use different credentials for dev/staging/production

## Troubleshooting

### Authentication Errors

**Error:** `Mixam credentials not configured`
- **Fix:** Ensure `MIXAM_USERNAME` and `MIXAM_PASSWORD` are set in `.env`

**Error:** `Mixam authentication failed (401)`
- **Fix:** Verify credentials are correct
- **Fix:** Check that your Mixam account has API access enabled

**Error:** `Mixam authentication response missing token field`
- **Fix:** Mixam API may have changed - check their documentation
- **Fix:** Verify you're using correct endpoint (`/token`)

### Token Expiration

- Tokens are cached and automatically refreshed
- 5-minute buffer prevents expiration during operations
- If you see frequent authentication requests, check token parsing logic

### Mock Mode Not Working

**Problem:** Real API calls when mock mode should be enabled
- **Fix:** Verify `MIXAM_MOCK_MODE=true` in `.env`
- **Fix:** Restart server after changing `.env`
- **Fix:** Check for typos in environment variable name

### Webhook Issues

**Problem:** Webhooks not received
- **Fix:** Verify webhook URL is publicly accessible
- **Fix:** Check Mixam dashboard for webhook configuration
- **Fix:** Ensure HTTPS is enabled (Mixam requires HTTPS)

**Problem:** Webhook signature verification fails
- **Fix:** Verify `MIXAM_WEBHOOK_SECRET` matches Mixam configuration
- **Fix:** Check that webhook secret hasn't changed in Mixam dashboard

## Testing Checklist

Before going live with real Mixam integration:

- [ ] Mock mode works end-to-end
- [ ] Can create orders in mock mode
- [ ] Admin approval workflow tested
- [ ] Webhook endpoint responds correctly
- [ ] Firestore security rules deployed
- [ ] Real credentials obtained from Mixam
- [ ] Webhook URL configured in Mixam dashboard
- [ ] Test order submitted to Mixam successfully
- [ ] Webhook received and processed correctly
- [ ] Order status updates reflected in UI
- [ ] Email notifications working (if implemented)

## Support

### Mixam Documentation
- API Reference: https://mixam.co.uk/documentation/api/public
- Security/Auth: https://mixam.co.uk/documentation/api/public#security
- MxJdf Specification: https://github.com/mixam-platform/MxJdf4

### Project Files
- API Client: `src/lib/mixam/client.ts`
- MxJdf Builder: `src/lib/mixam/mxjdf-builder.ts`
- Webhooks: `src/app/api/webhooks/mixam/route.ts`
- Admin UI: `src/app/admin/print-orders/`
- Parent UI: `src/app/storybook/[bookId]/order/`

### Getting Help
- Check console logs for detailed error messages
- Review Mixam API documentation
- Contact Mixam support for API-specific issues
- Check Firestore rules if permissions errors occur
