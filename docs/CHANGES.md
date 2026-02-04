# Change History

> **Purpose**: Track all significant changes to the codebase by commit ID for easy searching and reference.
>
> **IMPORTANT**: This document must be updated with every push to main. Append new entries at the top.

---

## How to Use This Document

- **Search by commit ID**: Use Ctrl+F / Cmd+F to find a specific commit
- **Search by feature**: Look for keywords in the description
- **Search by date**: Entries are ordered newest first

---

## Changes

### 2026-02-04

#### `93a4d9d` - Remove all browser automation code for Mixam order confirmation

**Type**: Code Removal

**Summary**: Removed all browser automation code (Puppeteer/Steel.dev) that was attempting to automate Mixam order confirmation. The automation never worked reliably due to dialog handling issues. Mixam provides a Public API with a proper `/api/public/orders/{orderId}/confirm` endpoint that should be used instead.

**Changes**:
- Removed `src/lib/mixam/browser-confirm.ts` (Steel.dev browser automation)
- Removed `src/app/api/admin/print-orders/[orderId]/confirm-mixam/route.ts` (API endpoint)
- Removed browser automation UI from print order detail page
- Removed `puppeteer-core` and `steel-sdk` dependencies from package.json
- Removed `STEEL_API_KEY` from apphosting.yaml
- Removed confirm-mixam endpoint documentation from docs/API.md

**Files Modified**:
- `src/app/admin/print-orders/[orderId]/page.tsx` - Removed Confirm Order button and related state
- `package.json` - Removed puppeteer-core and steel-sdk
- `apphosting.yaml` - Removed STEEL_API_KEY
- `docs/API.md` - Removed confirm-mixam endpoint documentation

**Files Deleted**:
- `src/lib/mixam/browser-confirm.ts`
- `src/app/api/admin/print-orders/[orderId]/confirm-mixam/route.ts`

---

### 2026-01-24

#### `535d0c1` - Switch to Steel.dev cloud browser for Mixam order confirmation

**Type**: Enhancement

**Summary**: Replaced local Puppeteer with Steel.dev cloud browser service for Mixam order confirmation. This solves the issue of Puppeteer not working in Firebase App Hosting (Cloud Run) environments which don't have Chrome installed.

**Changes**:
- Switched from `puppeteer` to `puppeteer-core` + `steel-sdk`
- Browser automation now runs in Steel.dev cloud instead of locally
- Supports both `submitted` and `on_hold` order statuses
- Added STEEL_API_KEY to environment configuration

**Files Modified**:
- `src/lib/mixam/browser-confirm.ts` - Rewrote to use Steel.dev SDK
- `src/app/api/admin/print-orders/[orderId]/confirm-mixam/route.ts` - Added on_hold status support
- `apphosting.yaml` - Added STEEL_API_KEY secret
- `docs/API.md` - Updated confirm-mixam endpoint documentation
- `package.json` - Replaced puppeteer with steel-sdk and puppeteer-core

---

#### `5d5e052` - Parse character names in regenerate instructions

**Type**: Enhancement

**Summary**: When parents add additional instructions during image regeneration, character names are now automatically converted to their `$$id$$` placeholder format. This ensures the AI image generator correctly identifies which character is being referenced.

**Example**:
- Parent types: "The child on this page is Nymira"
- System converts to: "The child on this page is $$abc123$$" (where abc123 is Nymira's ID)

**Changes**:
- Created utility function to replace actor display names with `$$id$$` placeholders
- Applied conversion in `handleConfirmRegenerate` before passing to image generation API
- Uses case-insensitive matching with word boundaries to avoid partial replacements

**Files Created**:
- `src/lib/replace-names-with-placeholders.ts` - Utility for name-to-placeholder conversion

**Files Modified**:
- `src/app/storybook/[bookId]/page.tsx` - Apply conversion in regenerate handler

---

#### `44ac99c` - Add Puppeteer browser automation for Mixam order confirmation

**Type**: Feature

**Summary**: Added browser automation to confirm Mixam orders from the admin panel. This is a temporary solution until Mixam provides an API endpoint for order confirmation.

**Changes**:
- Added Puppeteer dependency for browser automation
- Created browser automation utility that logs into Mixam and confirms orders
- Created `/api/admin/print-orders/[orderId]/confirm-mixam` endpoint
- Added "Confirm Order" button to print order detail page for orders in `submitted` status
- The automation logs in, navigates to the order page, checks the confirmation checkbox, and clicks confirm

**Files Created**:
- `src/lib/mixam/browser-confirm.ts` - Browser automation utility
- `src/app/api/admin/print-orders/[orderId]/confirm-mixam/route.ts` - API endpoint

**Files Modified**:
- `package.json` - Added Puppeteer dependency
- `src/app/admin/print-orders/[orderId]/page.tsx` - Added Confirm Order button
- `docs/API.md` - Added confirm-mixam endpoint documentation

**Note**: This is a temporary solution. A dev todo has been created to follow up with Mixam about an API endpoint.

---

### 2026-01-19

#### `ecca186` - Add internal API for Claude to create dev todos

**Type**: Feature

**Summary**: Added an internal API endpoint that allows Claude Code to create dev todo items without user authentication. Uses a shared secret for authentication.

**Changes**:
- Created `/api/internal/dev-todos` endpoint for Claude to POST dev todos
- Uses `X-Internal-Secret` header for authentication (no user auth required)
- Added `INTERNAL_API_SECRET` to apphosting.yaml
- Updated CLAUDE.md with instructions for using the internal API
- Updated API.md with Internal Routes documentation

**Files Created**:
- `src/app/api/internal/dev-todos/route.ts` - Internal API endpoint

**Files Modified**:
- `apphosting.yaml` - Added INTERNAL_API_SECRET secret
- `docs/API.md` - Added Internal Routes section
- `CLAUDE.md` - Updated dev todo instructions to use internal API

---

#### `d613834` - Webhook refresh and navigation improvements

**Type**: Enhancement

**Summary**: Two improvements to the print order system:
1. Added link to Mixam Catalogue page from Print Products admin page
2. Webhook handler now calls refresh-status API after receiving webhook to get authoritative status

**Changes**:
- Added "Mixam Catalogue & Settings" link at top of Print Products page
- Webhook now immediately calls Mixam API to refresh status after receiving a webhook
- Both webhook and API refresh interactions are logged together
- Only one email notification is sent (after combining webhook + refresh data)
- Tracking URL and estimated delivery from refresh are captured

**Files Modified**:
- `src/app/admin/print-products/page.tsx` - Added link to Mixam Catalogue
- `src/app/api/webhooks/mixam/route.ts` - Added refresh-status call after webhook

---

### 2026-01-18

#### `5d5a4cf` - Print order management improvements

**Type**: Enhancement

**Summary**: Multiple improvements to print order management:
1. Added "Shipped" tab to print orders page for tracking shipped/delivered orders
2. Allow resubmit for orders in "submitted" (Pending) state, not just "on_hold"
3. Removed unused MIXAM_PAYMENT_METHOD secret from apphosting.yaml (now stored in Firestore)

**Changes**:
- Added "Shipped" tab that shows orders with `shipped` and `delivered` statuses
- Renamed "Submitted" tab to "In Progress" (shows `submitted`, `confirmed`, `in_production`)
- Updated resubmit endpoint and UI to allow resubmitting orders in `submitted` status
- Removed MIXAM_PAYMENT_METHOD from apphosting.yaml (was causing build failure)

**Files Modified**:
- `src/app/admin/print-orders/page.tsx` - Added Shipped tab, renamed Submitted to In Progress
- `src/app/api/admin/print-orders/route.ts` - Added shipped filter, updated submitted filter
- `src/app/admin/print-orders/[orderId]/page.tsx` - Allow resubmit for submitted orders
- `src/app/api/admin/print-orders/[orderId]/resubmit/route.ts` - Allow submitted status
- `apphosting.yaml` - Removed MIXAM_PAYMENT_METHOD secret (now in Firestore)

---

#### `5e11560` - Make Mixam payment method configurable via Admin portal

**Type**: Enhancement

**Summary**: Made the Mixam payment method configurable from the Admin portal instead of being hardcoded. Previously, `paymentMethod` was hardcoded to `'TEST_ORDER'` which caused orders to go on hold. Now it can be set to `ACCOUNT` (production), `TEST_ORDER` (testing), or `CARD_ON_FILE` via the Mixam Settings page.

**Problem**: The `paymentMethod` was hardcoded to `'TEST_ORDER'` which told Mixam not to process orders, causing them to go on hold.

**Solution**:
1. Added `MixamConfig` type to store payment method setting in Firestore (`systemConfig/mixam`)
2. Created API endpoint `/api/admin/system-config/mixam` to get/update settings
3. Added Mixam Settings section to the Mixam Catalogue page (`/admin/mixam-catalogue`)
4. Both submit and resubmit endpoints now fetch the payment method from system config

**Files Created**:
- `src/app/api/admin/system-config/mixam/route.ts` - GET/PUT API for Mixam config

**Files Modified**:
- `src/lib/types.ts` - Added `MixamConfig` type and `DEFAULT_MIXAM_CONFIG`
- `src/lib/mixam/mxjdf-builder.ts` - Made `paymentMethod` a parameter instead of hardcoded
- `src/app/api/admin/print-orders/[orderId]/submit/route.ts` - Fetch payment method from config
- `src/app/api/admin/print-orders/[orderId]/resubmit/route.ts` - Fetch payment method from config
- `src/app/admin/mixam-catalogue/page.tsx` - Added Mixam Settings UI with payment method dropdown
- `docs/SCHEMA.md` - Document new `systemConfig/mixam` collection

---

#### `8a0701f` - Fix resubmit to cancel previous Mixam order and improve status refresh

**Type**: Bug Fix

**Summary**: Updated the resubmit endpoint to cancel the previous Mixam order before creating a new one, preventing orphaned orders in Mixam. Also improved the refresh status endpoint to handle all Mixam status codes case-insensitively.

**Problem**:
1. When resubmitting an on_hold order, the system was creating a new Mixam order without cancelling the previous one
2. The refresh status endpoint didn't handle ONHOLD/PENDING status codes from Mixam correctly

**Solution**:
1. The resubmit endpoint now cancels the previous Mixam order before creating a new one
2. The refresh status endpoint now normalizes Mixam status codes case-insensitively (ONHOLD → on_hold, PENDING → submitted)

**Files Modified**:
- `src/app/api/admin/print-orders/[orderId]/resubmit/route.ts` - Added cancellation logic before resubmission
- `src/app/api/admin/print-orders/[orderId]/refresh-status/route.ts` - Added case-insensitive status mapping for on_hold and pending
- `src/app/admin/print-orders/[orderId]/page.tsx` - Updated confirmation message and success feedback
- `docs/API.md` - Added documentation for the resubmit endpoint

---

#### `7872b61` - Add completion dialog and summary to dev todos

**Type**: Enhancement

**Summary**: Enhanced the development todo list to prompt for completion details when marking items complete. Completion summaries and commit IDs are now displayed on completed items and included when copying to Claude for reopened items.

**Features Added**:
- Completion dialog prompts for summary and commit ID when marking todo complete
- Completed todos display their completion summary, commit ID, and who completed them
- When copying a todo to Claude, any previous completion summary is included as context
- Checkbox click to mark complete now opens the completion dialog
- Menu "Mark Complete" option now shows dialog instead of immediately completing

**Files Modified**:
- `src/components/admin/DevTodoList.tsx` - Added completion dialog, display, and copy-to-Claude integration

---

### 2026-01-17

#### `7b2ae1c` - Add binding-aware minimum page count for PDF generation

**Type**: Bug Fix

**Summary**: Fixed PDF generation to enforce binding-specific minimum page counts. CASE binding (hardcover) requires at least 24 interior pages for proper spine thickness. Previously, PDFs could be generated with fewer pages, causing order submission to fail.

**Root Cause**: The `resolvePageConstraints` function didn't account for binding-specific minimums. Even if the PrintProduct had a lower `minPageCount`, CASE binding requires 24 pages minimum (Mixam constraint).

**Changes**:
- Added `getBindingMinPageCount()` helper to determine binding-specific minimums
- CASE and case_with_sewing bindings enforce 24-page minimum
- Other bindings default to 8-page minimum
- Binding minimum is enforced as a floor on all constraint sources (layout, product, default)

**Files Modified**:
- `src/lib/print-constraints.ts` - Added binding-aware minimum enforcement

---

#### `290d2ce` - Add completionSummary and commitId fields to dev todos

**Type**: Enhancement

**Summary**: Added ability to save a completion summary and git commit ID when completing dev todo items. This provides an audit trail of what was done and allows linking to specific commits.

**Changes**:
- Added `completionSummary` field to DevTodo type for storing what was accomplished
- Added `commitId` field to DevTodo type for linking to git commits
- Updated PUT endpoint to accept these fields when completing items
- When reopening a completed item, completion fields are automatically cleared

**Files Modified**:
- `src/lib/types.ts` - Added new fields to DevTodo type
- `src/app/api/admin/dev-todos/route.ts` - Handle new fields in PUT endpoint

**Documentation Updated**:
- `docs/SCHEMA.md` - Updated devTodos schema
- `docs/API.md` - Updated PUT endpoint documentation

---

#### `97827ad` - Implement incremental loading for storybooks page

**Type**: Performance Enhancement

**Summary**: Refactored the parent storybooks page (`/parent/storybooks`) to use server-side API endpoints instead of direct client-side Firestore queries. This significantly improves page load times for parents with many storybooks.

**Problem**: The storybooks page was making O(n×m) Firestore queries where n=stories and m=pages per story. For each storybook, it queried all pages to calculate thumbnails and audio status, causing slow load times.

**Solution**:
1. Created `/api/parent/storybooks` endpoint that returns document-level data without page queries
2. Created `/api/parent/storybooks/thumbnails` endpoint for incremental thumbnail/audio loading
3. Added `thumbnailUrl` field to `StoryBookOutput` type for caching cover images
4. Thumbnails are now cached on the storybook document when fetched, improving future load times

**Loading Strategy**:
- Initial load: Returns storybook list immediately with basic metadata
- Incremental: Thumbnails and audio status loaded asynchronously after render
- Caching: Thumbnails cached on document for faster subsequent loads

**Files Created**:
- `src/app/api/parent/storybooks/route.ts` - Main storybooks list API
- `src/app/api/parent/storybooks/thumbnails/route.ts` - Batch thumbnail fetching

**Files Modified**:
- `src/lib/types.ts` - Added `thumbnailUrl` field to `StoryBookOutput`
- `src/app/parent/storybooks/page.tsx` - Refactored to use API endpoints

**Documentation Updated**:
- `docs/API.md` - Added new endpoint documentation
- `docs/SCHEMA.md` - Added storybooks subcollection schema

---

#### `da8dd91` - Fix title page duplication in two-leaf spread PDFs

**Type**: Bug Fix

**Summary**: Fixed an issue where title pages (and blank pages) were being rendered twice in two-leaf spread layouts. Title pages should only generate one PDF page, not two.

**Root Cause**: When `leavesPerSpread === 2`, the interior PDF renderer was creating two PDF pages for every content item, including title pages and blank pages. However, these single-content pages don't have separate text/image boxes assigned to different leaves - they should remain as single pages.

**Changes**:
- Title pages and blank pages now generate 1 PDF page regardless of spread mode
- Only inside pages (text/image content) generate 2 PDF pages in two-leaf spread mode
- Updated page count calculation to correctly account for mixed single/spread pages
- Updated truncation logic to handle mixed page types
- Improved logging to show breakdown of single-page vs spread items

**Files Modified**:
- `src/app/api/storyBook/printable/route.ts` - Fixed interior PDF rendering and page count logic

---

#### `8e02594` - Fix AI Models config field-level auto-seeding

**Type**: Bug Fix

**Summary**: Fixed issue where Firestore document existed but was missing model configuration fields, causing "undefined" model errors.

**Root Cause**: The initial auto-seed only wrote `availabilityCheck`, `createdAt`, and `createdBy` fields, but not the actual model configuration fields (`imageGenerationModel`, etc.).

**Changes**:
- Build config with explicit field-by-field defaults (not spread merge)
- Auto-seed model fields even when document exists but is missing them
- Check for `!docData?.imageGenerationModel` to detect incomplete documents

**Files Modified**:
- `src/app/api/admin/ai-models/route.ts` - Field-level default handling
- `src/app/api/admin/ai-models/check-availability/route.ts` - Same fix

---

#### `b819ad2` - Fix AI Models admin page errors and add auto-seeding

**Type**: Bug Fix

**Summary**: Fixed errors on the `/admin/ai-models` page and added auto-seeding of the Firestore configuration document.

**Issues Fixed**:
- "Failed to load configuration" error on page load when no Firestore document existed
- "Cannot use undefined as a Firestore value" error when running availability check
- Ensured all model values have defaults to prevent undefined values

**Changes**:
- Auto-seed `systemConfig/aiModels` document with defaults on first admin access
- Sanitize issue objects before storing to Firestore (prevent undefined values)
- Added fallback to defaults for any missing model configuration values
- Updated CLAUDE.md with explicit triggers for when SYSTEM_DESIGN.md must be updated

**Files Modified**:
- `src/app/api/admin/ai-models/route.ts` - Auto-seed on first access
- `src/app/api/admin/ai-models/check-availability/route.ts` - Sanitize issues, use default values
- `CLAUDE.md` - Added explicit SYSTEM_DESIGN.md update triggers

---

#### `9e21034` - Add Development Todo List feature

**Type**: Feature

**Summary**: Added a development todo list to the admin Development page that tracks work items for production readiness. Both admins and Claude can add items to this list.

**Features**:
- Todo list UI with add/edit/delete functionality
- Markdown support for descriptions with live preview
- Status tracking (pending, in_progress, partial, completed)
- Priority levels (low, medium, high)
- Categories for organization
- "Copy for Claude" button to format todos for pasting to AI
- Collapsible descriptions with hover preview
- Track who created/completed items (admin vs Claude)

**Files Created**:
- `src/app/api/admin/dev-todos/route.ts` - CRUD API endpoints
- `src/components/admin/DevTodoList.tsx` - UI component

**Files Modified**:
- `src/lib/types.ts` - Added DevTodo, DevTodoStatus, DevTodoPriority types
- `src/app/admin/dev/page.tsx` - Added DevTodoList component
- `CLAUDE.md` - Added instructions for Claude to add dev todos
- `docs/SCHEMA.md` - Added devTodos collection documentation
- `docs/API.md` - Added dev-todos API endpoint documentation

---

#### `10dcd9f` - Remove environment variable override for AI model configuration

**Type**: Simplification

**Summary**: Removed support for `STORYBOOK_IMAGE_MODEL` environment variable override. AI model configuration is now only controlled via the Firestore `systemConfig/aiModels` document and the admin UI at `/admin/ai-models`.

**Changes**:
- Removed env var check from `getImageGenerationModel()`
- Removed env override display from admin UI
- Updated documentation to remove env var priority note

**Files Modified**:
- `src/lib/ai-model-config.ts` - Removed env var override
- `src/app/api/admin/ai-models/route.ts` - Removed envOverrides from response
- `src/app/admin/ai-models/page.tsx` - Removed env override display
- `docs/SCHEMA.md` - Removed env var priority note

---

#### `417aec4` - Fix AI Models page and improve error handling

**Type**: Bug Fix

**Summary**: Fixed multiple issues with the AI Models admin page and improved error handling for image generation failures.

**Fixes**:
1. Fixed misleading "Rate limit exceeded" error when the wrong model was being used for image generation (the pattern 'rate' was matching 'aspect ratio')
2. Fixed AI Flow Log not capturing model name on error logs (now stored at top level)
3. Fixed "Cannot read properties of undefined (reading 'replace')" error in Check Availability
4. Added null-safety for model name handling in admin page

**Files Modified**:
- `src/ai/flows/story-image-flow.ts` - Fixed error classification and added model config error handling
- `src/lib/ai-flow-logger.ts` - Always store model name at top level for visibility
- `src/app/admin/ai-models/page.tsx` - Added null-safety for model names
- `src/app/api/admin/ai-models/check-availability/route.ts` - Added null-safety

---

### 2026-01-16

#### `c1d32d4` - Fix AI Models page null check and add nav button to admin

**Type**: Bug Fix

**Summary**: Fixed undefined config access in AI Models page and added AI Models button to admin dashboard.

**Files Modified**:
- `src/app/admin/ai-models/page.tsx`
- `src/app/admin/page.tsx`

---

#### `8b359e4` - Add AI Models admin page and central model configuration

**Type**: Feature, Bug Fix

**Summary**: Fixed image generation failure caused by deprecated `gemini-2.5-flash-image-preview` model (deprecated January 15, 2026). More importantly, created an admin page to manage AI model configuration and check model availability, preventing future deprecation surprises.

**Problem Solved**: Model names were hardcoded across 9+ files with no monitoring for deprecation. When Google deprecated the preview model, all image generation failed with 404 errors and no alerting occurred.

**Solution**:
1. Central configuration in Firestore (`systemConfig/aiModels`) with 1-minute caching
2. Admin UI at `/admin/ai-models` to view/change model selections
3. Availability checking against Google AI API (`listModels` endpoint)
4. Integration with maintenance alerting for model issues
5. Environment variable override preserved for deployment flexibility

**Changes**:
- Created central AI model config module with caching
- Created admin UI page with model configuration and availability checking
- Created API endpoints for model config CRUD and availability checking
- Updated all 9 image generation flows to use central config
- Added AIModelsConfig types and defaults
- Documented new schema and API routes

**Files Created**:
- `src/lib/ai-model-config.ts` - Central config module with caching
- `src/app/admin/ai-models/page.tsx` - Admin UI page
- `src/app/api/admin/ai-models/route.ts` - GET/PUT config API
- `src/app/api/admin/ai-models/check-availability/route.ts` - Check availability API

**Files Modified**:
- `src/lib/types.ts` - Added AIModelsConfig, AIModelAvailabilityCheck, GoogleAIModelInfo types
- `src/ai/flows/story-image-flow.ts` - Use central config
- `src/ai/flows/avatar-flow.ts` - Use central config
- `src/ai/flows/actor-exemplar-flow.ts` - Use central config
- `src/ai/flows/character-avatar-flow.ts` - Use central config
- `src/ai/flows/image-style-sample-flow.ts` - Use central config
- `src/ai/flows/avatar-animation-flow.ts` - Use central config
- `src/ai/flows/story-exemplar-generation-flow.ts` - Use central config
- `src/ai/flows/story-actor-avatar-flow.ts` - Use central config
- `src/ai/flows/story-output-type-image-flow.ts` - Use central config
- `docs/SCHEMA.md` - Added systemConfig/aiModels documentation
- `docs/API.md` - Added new API routes

---

#### `0c2be78` - Fix postcode lookup to use correct getAddress.io API flow

**Type**: Bug Fix

**Summary**: Fixed postcode lookup to use the correct getAddress.io Autocomplete + Get API flow instead of the deprecated Find endpoint. The Find endpoint was returning 404 for all postcodes.

**Changes**:
- Changed from `/find/{postcode}` endpoint to `/autocomplete/{postcode}` for suggestions
- Added `/get/{id}` calls to fetch full address details for each suggestion
- Limited to 10 addresses per postcode to avoid rate limits
- Added proper types for Autocomplete and Get API responses

**Files Modified**:
- `src/app/api/postcode/lookup/route.ts`

---

### 2026-01-14

#### `1ef4eee` - Smarter image scaling with distortion threshold

**Type**: Enhancement

**Summary**: Improved image rendering in PDF boxes with a smart distortion threshold approach. If stretching the image to fill the box requires less than 10% distortion, it fills the box completely. If more than 10% distortion would be needed, it shrinks to fit while maintaining aspect ratio.

**Changes**:
- Calculate distortion percentage when comparing image and box aspect ratios
- Fill box completely if distortion is ≤10% (imperceptible stretching)
- Shrink to fit with centering if distortion would be >10%
- Added detailed logging showing fill mode and distortion percentage

**Files modified**:
- `src/app/api/storyBook/printable/route.ts` - Smart image scaling logic

---

#### `6f9889c` - Fix two-leaf spread, image aspect ratio, and add custom fonts

**Type**: Bug fix, Enhancement

**Summary**: Fixed PDF generation issues and added custom Google Fonts support:
1. Combined PDF was rendering both text and image on the same page instead of creating a two-page spread
2. Images in constrained boxes were being stretched to fill the box, distorting aspect ratio
3. Added 6 child-friendly Google Fonts (Comic Neue, Nunito, Patrick Hand, Quicksand, Lexend) with full TTF embedding
4. Expanded PDF Base 14 fonts from 4 to all 12 text variants

**Changes**:
- Added `isTwoLeafSpread` check to `renderCombinedPdf` function
- Non-cover pages now create two PDF pages when `leavesPerSpread === 2`
- Each leaf renders its designated content (text on leaf 1, image on leaf 2)
- Cover pages remain single pages as before
- Images in boxes now shrink to fit while maintaining aspect ratio
- Images are centered within their designated box
- Installed `@pdf-lib/fontkit` for custom font embedding
- Added child-friendly Google Fonts TTF files to `public/fonts/`
- Created `embedFont()` function to handle both standard and custom fonts
- Expanded `getStandardFont()` to support all PDF Base 14 fonts
- Updated print layouts admin UI with 18 font options (6 custom + 12 standard)

**Files modified**:
- `src/app/api/storyBook/printable/route.ts` - Two-leaf spread logic, aspect-ratio-preserving image rendering, custom font support
- `src/app/admin/print-layouts/page.tsx` - Added all font options to the font selector
- `public/fonts/` - Added 6 Google Font TTF files (Comic Neue, Nunito, Patrick Hand, Quicksand, Lexend)
- `package.json` - Added `@pdf-lib/fontkit` dependency

---

#### `4759c70` - Add print layout selector to Print Options dialog

**Type**: Feature

**Summary**: Added ability for parents to select a different print layout when viewing Print Options for a storybook. The storybook's default layout (set during creation) is shown initially, but parents can choose any available layout and regenerate PDFs with different dimensions/formatting.

**Changes**:
- Added print layouts query to parent storybooks page
- Added layout selector dropdown to Print Options dialog
- Shows default layout with "(default)" indicator
- Other layouts show dimensions (e.g., "8" × 10"")
- Regenerate PDFs uses selected layout (or reverts to default)
- Selected layout resets when dialog opens

**Files modified**:
- `src/app/parent/storybooks/page.tsx` - Added layout selector and related state

---

#### `36c1238` - Fix PDF rendering to respect textBoxEnabled/imageBoxEnabled flags

**Type**: Bug fix

**Summary**: Fixed PDF generation routes to properly check the `textBoxEnabled` and `imageBoxEnabled` flags from the print layout configuration. Previously, even when text box was disabled for a page type (e.g., front cover), the PDF would still render text over the image using default positioning.

**Changes**:
- Added `imageEnabled` and `textEnabled` checks before rendering content
- These flags are now combined with the existing leaf targeting logic
- Updated debug logging to show enabled states

**Files modified**:
- `src/app/api/storyBook/printable/route.ts` - Added enabled flag checks
- `src/app/api/printStoryBooks/[printStoryBookId]/generate-pdfs/route.ts` - Added enabled flag checks

---

#### `c3204b0` - Fix actor extraction in pagination and exemplar flows

**Type**: Bug fix

**Summary**: Fixed the `storyPaginationFlow` and `storyExemplarGenerationFlow` to extract actor IDs from story text when `story.actors` is empty. This ensures wizard stories (and other legacy stories) get proper character context during pagination and exemplar generation.

**Issues Fixed**:
1. **Pagination showing "No actors found"** - Pagination only looked at `story.actors` which may not be set
2. **Exemplars only generated for main child** - Same issue, non-child characters were skipped

**Fix**:
- Added `extractEntityIds()` function to both flows to extract `$$id$$` placeholders from story text
- If `story.actors` is empty, fall back to extracting IDs from story text
- Always ensure `childId` is included as first actor
- Added debug logging to track actor ID source

**Files modified**:
- `src/ai/flows/story-pagination-flow.ts` - Added fallback actor extraction
- `src/ai/flows/story-exemplar-generation-flow.ts` - Added fallback actor extraction

---

#### `8d6a39e` - Unify Story Wizard post-generation with other generators

**Type**: Bug fix / Architecture improvement

**Summary**: Fixed the Story Wizard flow to trigger the same post-generation tasks as other story generators. Previously, wizard stories were created directly without calling `/api/storyCompile`, which meant they missed out on synopsis generation, AI voice narration, cast avatar generation, and title regeneration.

**Issues Fixed**:
1. **Cast Avatar not auto-generated** - Wizard stories now trigger `storyActorAvatarFlow`
2. **Synopsis not generated** - Wizard stories now get a proper synopsis via `storyCompileFlow`
3. **AI Voice not auto-generated** - Wizard stories now trigger `storyAudioFlow`
4. **Title generation status missing** - Wizard stories now have proper generation status fields

**Technical Details**:
- After wizard completes (state='finished'), the client now calls `/api/storyCompile` before redirecting to style selection
- The `storyCompileFlow` already had wizard mode handling (lines 295-417) which generates synopsis and sets up generation status fields
- The `/api/storyCompile` route's `after()` block triggers parallel background tasks: audio, cast avatar, and title generation
- This ensures all story generators produce consistent data structures and trigger the same post-generation flows

**Files modified**:
- `src/app/kids/create/page.tsx` - Added storyCompile call after wizard completion

---

#### `4bac32f` - Fix PDF page count calculation for dual-leaf spreads

**Type**: Bug fix

**Summary**: Fixed the page count calculation in the printable PDF generation route to correctly account for `leavesPerSpread`. When a layout uses 2 leaves per spread, each content item generates 2 PDF pages, which must be factored into the padding calculation for Mixam's multiple-of-4 requirement.

**Changes**:
- Content page count now multiplies by `pdfPagesPerContent` (2 for dual-leaf, 1 for single)
- Truncation logic correctly converts PDF pages back to content items
- Added detailed logging showing the full page breakdown calculation
- Fixed metadata to report correct `pageCount` and `contentPageCount` values

**Files modified**:
- `src/app/api/storyBook/printable/route.ts` - Fixed calculation and added logging

---

#### `bf8e978` - Add Q&A animations system with sound effects

**Type**: Feature

**Summary**: Implemented a complete Q&A animation system for story creation. When a child answers a question, non-selected answers animate off-screen with sound effects, followed by the selected answer celebrating and exiting. This engages children during the waiting period while the next question is being generated.

**Features**:
1. **10 Exit Animations**: Slide left/right/up/down, shrink, spin, bounce, float, explode, fade
2. **1 Selection Animation**: Celebrate with wiggle, then slide right
3. **Sound Effects**: ElevenLabs text-to-sound-effects integration for each animation
4. **Writer Portal**: New admin page at `/admin/answer-animations` to configure animations:
   - Edit duration and easing
   - Generate sound effects via ElevenLabs
   - Test button to preview animation with sound
5. **Story Browser Integration**: Animations play automatically when child selects an answer

**Files created**:
- `src/lib/animation-presets.ts` - Default animation CSS definitions
- `src/app/api/soundEffects/seed/route.ts` - Seed default animations to Firestore
- `src/app/api/soundEffects/generate/route.ts` - Generate sound effects via ElevenLabs
- `src/app/admin/answer-animations/page.tsx` - Writer portal animation manager
- `src/components/story/animated-choice-button.tsx` - Choice button with animation support

**Files modified**:
- `src/lib/types.ts` - Added `AnswerAnimation` types
- `src/components/story/story-browser.tsx` - Integrated animation playback on answer selection
- `src/app/writer/page.tsx` - Added link to answer animations admin page
- `firestore.rules` - Added rules for `answerAnimations` collection (v20)
- `docs/SCHEMA.md` - Documented `answerAnimations` collection
- `docs/API.md` - Documented sound effects API routes

---

#### `376b9b8` - Add print layout enhancements: enabled toggles, leaf selection, duplicate/delete

**Type**: Feature

**Summary**: Enhanced print layouts with three major features:
1. **Text/Image Box Toggles**: Each page type (cover, back cover, inside, title) now has enable/disable toggles for text boxes and image boxes, allowing layouts that omit either element
2. **Leaf Selection for Two-Page Spreads**: When a layout uses 2 leaves per spread, the admin can specify which leaf (1=left, 2=right) each text box and image box should appear on. PDF generation creates two pages per content item, placing content on the correct leaf.
3. **Duplicate/Delete Layouts**: Added buttons to duplicate (creates copy with "(Copy)" suffix) and delete print layouts

**Files modified**:
- `src/lib/types.ts` - Added `textBoxEnabled` and `imageBoxEnabled` to `PageLayoutConfig`
- `src/lib/print-layout-utils.ts` - Updated `getLayoutForPageType()` to respect enabled flags
- `src/app/admin/print-layouts/page.tsx` - Added toggle switches, leaf dropdowns, duplicate/delete buttons
- `src/app/api/printStoryBooks/[printStoryBookId]/generate-pdfs/route.ts` - Added `targetLeaf` parameter and two-leaf spread rendering
- `src/app/api/storyBook/printable/route.ts` - Added `targetLeaf` parameter and two-leaf spread rendering
- `docs/SCHEMA.md` - Documented new fields and types

---

### 2026-01-12

#### `3c239df` - Add hover-to-fade on storybook player text panel

**Type**: Enhancement

**Summary**: Added a hover effect to the text panel in the immersive storybook player. When users hover over the text overlay, it fades to 10% opacity, allowing the image underneath to be seen more clearly.

**Files modified**:
- `src/components/book-reader/immersive-player.tsx` - Added `transition-opacity duration-300 hover:opacity-10` classes

---

#### `f2d0173` - Improve exemplar generation prompt for better context

**Type**: Enhancement

**Summary**: Improved the character reference sheet (exemplar) generation prompt in several ways:
1. Removed assumption that all characters have hair ("hair framing the face" → just "eyes, eyebrows, nose, mouth, ears")
2. Made age guidance dynamic based on the main child's actual age (e.g., "3 years old") instead of hardcoded "young children"
3. Added story synopsis to the prompt so the generator can choose appropriate clothing and accessories for the story's context

**Changes**:
- Added `childAge` and `synopsis` parameters to `generateExemplarForActor()` function
- Calculate child's age from their `dateOfBirth` (displays as "X months old" or "X years old")
- Include story synopsis section when available with guidance for clothing choices
- Added conditional "if the character has hair" qualifier to hair consistency requirement

**Files modified**:
- `src/ai/flows/story-exemplar-generation-flow.ts` - Updated prompt and function parameters

---

#### `30456a1` - Remove redundant exemplarImage URLs from character JSON

**Type**: Optimization

**Summary**: Removed the redundant `exemplarImage` URL field from the character JSON in image generation prompts. The exemplar images are already attached as actual images to the prompt and mapped via the `IMAGE-TO-CHARACTER MAPPING` text section, so including the URL as text was redundant and wasted tokens.

**Before**: Character JSON included both `"images": []` and `"exemplarImage": "https://..."` when exemplars were used.

**After**: Character JSON only includes `"images": []` when exemplars are used. The model maps images to characters via the explicit text mapping section.

**Files modified**:
- `src/ai/flows/story-image-flow.ts` - Removed `exemplarImage` field from `ActorData` type and `buildActorData()` function

---

#### `5ac7334` - Fix exemplar image mapping and add AI log export

**Type**: Bug Fix / Enhancement

**Summary**: Fixed two issues with exemplar images in storybook generation:
1. All exemplars were being passed to every page, even when only one character appeared on a page
2. When multiple characters were on a page, the model had no way to know which exemplar belonged to which character

Also added selection and export functionality to the AI Flow Logs admin page.

**Changes**:

1. **Per-page exemplar filtering** (`images/route.ts`):
   - Now filters `actorExemplarUrls` to only include actors that appear on each specific page
   - Prevents passing 4 exemplars when only 1 character is on the page

2. **Ordered exemplar tracking** (`story-image-flow.ts`):
   - `buildActorsJson` now returns `{ json, orderedExemplars }` where `orderedExemplars` tracks actor ID, display name, and URL in order
   - New `BuildActorsResult` type to capture this structured return value

3. **Explicit image-to-actor mapping in prompt** (`story-image-flow.ts`):
   - Prompt now includes explicit mapping like:
     ```
     IMAGE-TO-CHARACTER MAPPING:
     - Image 2: Reference sheet for "Emma" ($$abc123$$)
     - Image 3: Reference sheet for "Fluffy" ($$def456$$)
     ```
   - Removed `exemplarImages: string[]` param in favor of `orderedExemplars` which preserves actor identity
   - Removed redundant `hasExemplars` param (now derived from `loadedExemplars.length > 0`)

4. **AI Flow Logs export** (`ai-logs/page.tsx`):
   - Added checkbox selection to each log row
   - Added toolbar with Select All/Deselect All, Copy JSON, and Download buttons
   - Allows exporting selected logs for diagnostic analysis

**Files modified**:
- `src/app/api/storybookV2/images/route.ts`
- `src/ai/flows/story-image-flow.ts`
- `src/app/admin/ai-logs/page.tsx`

---

#### `68a7d2e` - Add storyId and storybookId to AI flow logs

**Type**: Enhancement

**Summary**: Added `storyId` and `storybookId` fields to AI flow log entries for storybook-related flows. This makes it easier to trace and debug flows by filtering logs to a specific story or storybook.

**Changes**:
1. **ai-flow-logger.ts**:
   - Added optional `storyId` and `storybookId` parameters to `LogAIFlowParams`
   - Writes these fields to log documents when provided

2. **story-image-flow.ts**:
   - Added `storyId` and `storybookId` to `CreateImageParams` type
   - Passes these IDs through to all `logAIFlow` calls (success, failure, and error cases)

3. **story-exemplar-generation-flow.ts**:
   - Added `storybookId` to `generateExemplarForActor` parameters
   - Passes both IDs to all `logAIFlow` calls

**Files modified**:
- `src/lib/ai-flow-logger.ts`
- `src/ai/flows/story-image-flow.ts`
- `src/ai/flows/story-exemplar-generation-flow.ts`

---

#### `5f23cfe` - Fix exemplar URLs not being used for image generation

**Type**: Bug Fix

**Summary**: Fixed a race condition where exemplar images were generated successfully but not passed to the image generation flow. When the exemplar status was 'ready' but the storybook data had been read before the URLs were written, the images route would skip waiting and use stale (empty) URL data.

**Root Cause**: The images route reads storybook data once at the start, then checks exemplar status. If status is 'ready' (exemplars completed), it assumes the URLs are available in that initial read. But if the data was read just before exemplars finished writing, the URLs would be missing.

**Changes**:
1. **images/route.ts**:
   - Added re-read logic when exemplar status is 'ready' but URLs are empty
   - Logs when this race condition is detected and corrected
   - Ensures the latest `actorExemplarUrls` is always used

**Files modified**:
- `src/app/api/storybookV2/images/route.ts`

---

#### `b6f6014` - Add exemplar layout description to image generation prompts

**Type**: Enhancement

**Summary**: Updated the image generation prompts to include a detailed description of the exemplar reference sheet layout (2x2 grid with face close-up in top-left). Emphasizes that the face close-up is critical for facial feature matching to maintain character consistency across all generated images.

**Changes**:
1. **story-image-flow.ts**:
   - Updated exemplar instructions in `createImage()` to describe actual 2x2 grid layout
   - Added specific guidance for each quadrant (face close-up, front, 3/4, back)
   - Added CRITICAL emphasis that face close-up in top-left is the most important reference
   - Instructs AI to match facial features (eyes, nose, mouth, hair, skin tone) exactly
   - Updated character list instruction to mention paying special attention to face close-up

**Files modified**:
- `src/ai/flows/story-image-flow.ts`

---

#### `9d4dc02` - Put face close-up first in exemplar layout

**Type**: Enhancement

**Summary**: Moved the face close-up to the TOP-LEFT (first) position in the exemplar reference sheet since the face is the most important element for character recognition and consistency. Emphasized that face matching is critical for character recognition across scenes.

**Changes**:
1. **story-exemplar-generation-flow.ts**:
   - Moved FACE CLOSE-UP from bottom-right to TOP-LEFT (first quadrant)
   - Reordered quadrant details to list face first "in order of importance"
   - Added "THE FACE IS THE MOST IMPORTANT ELEMENT" header before layout
   - Emphasized facial feature matching in requirements
   - Added note that face close-up is "critical for ensuring the character is recognizable in every scene"

**New layout** (2x2 grid with face first):
```
┌─────────────────┬─────────────────┐
│   TOP-LEFT:     │   TOP-RIGHT:    │
│   FACE CLOSE-UP │   FRONT VIEW    │
│   (HEAD ONLY)   │   (full body)   │
├─────────────────┼─────────────────┤
│   BOTTOM-LEFT:  │   BOTTOM-RIGHT: │
│   3/4 VIEW      │   BACK VIEW     │
│   (full body)   │   (full body)   │
└─────────────────┴─────────────────┘
```

**Files modified**:
- `src/ai/flows/story-exemplar-generation-flow.ts`

---

#### `5ac7334` - Wait for exemplar generation before image generation

**Type**: Fix

**Summary**: The images route now waits for exemplar generation to complete before starting page image generation. Previously, if the images endpoint was called while exemplar generation was still running, it would proceed without the exemplars and fall back to using photos. Now it polls for up to 2 minutes waiting for exemplars to be ready, ensuring character reference sheets are used for consistent character depiction.

**Changes**:
1. **images/route.ts**:
   - Added polling loop that waits for `exemplarGeneration.status` to become 'ready' or 'error'
   - Polls every 3 seconds for up to 2 minutes
   - Falls back to photos if exemplars time out or fail
   - Improved logging to show wait progress

**Files modified**:
- `src/app/api/storybookV2/images/route.ts`

---

#### `5ac7334` - Include failure reasons in AI flow logs

**Type**: Fix

**Summary**: AI flow logs now include response metadata and failure reasons even when the AI call fails or returns no usable output. This allows the admin UI to display why image generation failed (e.g., safety filters, no image returned).

**Changes**:
1. **ai-flow-logger.ts**:
   - Always include response metadata (text, finishReason, finishMessage, model) even for errors/failures
   - Always include usage data even for errors/failures
   - Added 'failure' status for calls that complete but return no usable output

2. **ai-logs/page.tsx**:
   - Display `failureReason` field with amber styling for failures
   - Display `finishReason` and `finishMessage` for non-success statuses

3. **types.ts**:
   - Added 'failure' to AIFlowLog status union type
   - Added `failureReason` field to AIFlowLog
   - Added `finishMessage` to response object
   - Made response fields nullable to match actual data

**Files modified**:
- `src/lib/ai-flow-logger.ts`
- `src/app/admin/ai-logs/page.tsx`
- `src/lib/types.ts`

---

#### `aca4fe5` - Add title text to cover page images

**Type**: Enhancement

**Summary**: Updated front cover image generation to include the story title and author name rendered directly in the image. Uses best practices for AI text generation: specifying exact text in quotes, requesting specific placement, emphasizing legibility, and requesting child-friendly fonts.

**Changes**:
1. **story-image-flow.ts**:
   - Added `storyTitle` and `mainChildName` parameters to `CreateImageParams`
   - Front cover prompt now includes explicit text rendering requirements
   - Title must be placed at top with large, clear, legible letters
   - Author credit ("by [Name]") placed below title
   - Emphasis on correct spelling and child-friendly fonts

**Text rendering best practices applied**:
- Exact text specified in quotes
- Specific placement instructions (top of image)
- Request for legible, rounded fonts
- Contrasting colors requirement
- Spelling verification instruction

**Files modified**:
- `src/ai/flows/story-image-flow.ts`

---

#### `68fc643` - Improve cover page image generation prompt

**Type**: Enhancement

**Summary**: Improved the AI prompt for generating front and back cover images. The prompts now explicitly instruct the AI to create a book cover with specific composition requirements, include the full story synopsis for context, and leave space for title overlay.

**Changes**:
1. **story-image-flow.ts**: Added page-kind-specific prompt handling for `cover_front` and `cover_back`. Front covers get explicit instructions about composition, leaving space for title, and capturing the story's spirit. Back covers get instructions for a warm concluding scene.
2. **story-page-flow.ts**: Enhanced `buildFrontCoverImagePrompt` to provide richer context including the story title, full synopsis, and visual direction guidance.
3. **story-exemplar-generation-flow.ts**: Fixed invalid aspect ratio (2:1 → 21:9) for exemplar reference sheets.

**Files modified**:
- `src/ai/flows/story-image-flow.ts`
- `src/ai/flows/story-page-flow.ts`
- `src/ai/flows/story-exemplar-generation-flow.ts`

---

#### `866f8fa` - Add admin button to delete exemplar images

**Type**: Feature

**Summary**: Added admin UI and API endpoint to delete all exemplar images from Firebase Storage. Exemplars are temporary reference images used during page generation and can be safely deleted once all storybook pages are generated.

**Changes**:
1. **New API endpoint**: `/api/admin/cleanup-exemplars` - GET returns count of exemplar files, DELETE removes all exemplar files from storage
2. **Admin cleanup page**: Added "Exemplar Images (Storage)" section with Check Count and Delete All buttons

**Files created**:
- `src/app/api/admin/cleanup-exemplars/route.ts`

**Files modified**:
- `src/app/admin/cleanup/page.tsx`

---

#### `2d0bb31` - Simplify exemplar generation flow

**Type**: Refactor

**Summary**: Simplified exemplar generation to run immediately after pagination completes, in parallel with audio generation. Each actor now gets their own AI flow call, producing individual entries in `aiFlowLogs`. The images route no longer triggers exemplar generation - it simply uses whatever exemplar URLs are already stored.

**Changes**:
1. **New flow**: `storyExemplarGenerationFlow` - generates exemplar images for all actors in a storybook in parallel, stores URLs directly on the storybook document
2. **pages/route.ts**: Now triggers exemplar generation in parallel with audio after pagination completes
3. **images/route.ts**: Simplified to read `actorExemplarUrls` from storybook instead of calling exemplars endpoint
4. **story-image-flow.ts**: Changed `actorExemplars` (IDs) to `actorExemplarUrls` (URLs) - no longer needs to load exemplar documents from Firestore
5. **types.ts**: Added `actorExemplarUrls` field to `StoryBookOutput`, deprecated `actorExemplars`

**New flow sequence**:
- Pagination completes
- In parallel: Audio generation + Exemplar generation (one AI call per actor)
- Image generation uses stored exemplar URLs (or falls back to photos if not ready)

**Files created**:
- `src/ai/flows/story-exemplar-generation-flow.ts`

**Files modified**:
- `src/app/api/storybookV2/pages/route.ts`
- `src/app/api/storybookV2/images/route.ts`
- `src/ai/flows/story-image-flow.ts`
- `src/lib/types.ts`

---

#### `25914e6` - Mark image generation failures clearly in AI flow logs

**Type**: Enhancement

**Summary**: Added `isFailure` and `failureReason` parameters to AI flow logging. When an image generation flow receives a response from the model but no image is returned (e.g., due to content filtering or safety blocks), the log entry is now marked with `status: 'failure'` instead of `status: 'success'`, and includes the specific failure reason.

**Changes**:
1. **ai-flow-logger.ts**: Added new parameters `isFailure` (boolean) and `failureReason` (string) to explicitly mark failures without an exception. When `isFailure=true`, sets `status: 'failure'` and stores the `failureReason`.
2. **All image generation flows**: Updated to pass `isFailure: true` and detailed `failureReason` when the model returns a response but no image. The failure reason includes `finishReason`, `finishMessage`, and any text response from the model.

**Files modified**:
- `src/lib/ai-flow-logger.ts` - Add isFailure and failureReason parameters
- `src/ai/flows/story-image-flow.ts` - Mark no-media responses as failures
- `src/ai/flows/actor-exemplar-flow.ts` - Mark no-media responses as failures
- `src/ai/flows/avatar-flow.ts` - Mark no-media responses as failures
- `src/ai/flows/character-avatar-flow.ts` - Mark no-media responses as failures
- `src/ai/flows/story-actor-avatar-flow.ts` - Mark no-media responses as failures
- `src/ai/flows/story-output-type-image-flow.ts` - Mark no-media responses as failures
- `src/ai/flows/image-style-sample-flow.ts` - Mark no-media responses as failures

---

#### `d555660` - Fix duplicate AI flow logs and add exemplar debugging

**Type**: Bug Fix

**Summary**: Fixed duplicate logging in storyImageFlow and added debugging for exemplar generation.

**Changes**:
1. **Fixed duplicate logs**: storyImageFlow was logging twice for each successful image generation (once in retry loop, once after upload). Now only logs once after upload for successful cases, while still logging failures/retries for debugging.
2. **Added exemplar debugging**: Added log message showing which exemplar IDs are being passed to image generation to help diagnose why exemplars aren't being used.

**Files modified**:
- `src/ai/flows/story-image-flow.ts` - Move success logging outside retry loop
- `src/app/api/storybookV2/images/route.ts` - Add exemplar debugging log

---

#### `d631bca` - Handle TTS directive tags based on ElevenLabs API version

**Type**: Enhancement

**Summary**: Updated text normalization to handle ElevenLabs TTS directive tags (like `[emphasis]`, `[British accent]`) differently based on the API version:
- Display text: Always strips `[...]` tags (they're not meant for users to see)
- TTS with v2: Strips `[...]` tags (v2 doesn't support them)
- TTS with v3: Keeps `[...]` tags and adds `[British accent]` prefix

**Changes**:
- `replacePlaceholdersInText`: Now strips TTS directive tags for display
- `replacePlaceholdersForTTS`: Checks API version and handles tags accordingly
- Added new `stripTTSDirectiveTags` helper function
- v3 TTS now automatically prefixes text with `[British accent]`

**Files modified**:
- `src/lib/resolve-placeholders.server.ts`

---

#### `c8c284d` - Fix exemplar regeneration, duplicate generation, and actor data in prompts

**Type**: Bug Fix

**Summary**: Fixed multiple issues with image generation:
1. Exemplar route was returning early with empty actorExemplars when status was 'ready'
2. Concurrent requests to the images route could cause duplicate image generation
3. Actor JSON in prompts included both exemplarImage AND individual photos - now uses only exemplar when available
4. Prompt instructions now clearly direct the AI to use exemplar reference sheets vs photos

**Changes**:
- Added check for empty `actorExemplars` when status is 'ready' in exemplars route
- Added logging when regenerating due to empty actorExemplars
- Added guard to prevent concurrent image generation (returns 409 if already running)
- Modified `buildActorData` to return empty `images` array when `exemplarImage` is provided
- Updated prompt instructions to clearly explain which images are character reference sheets vs style examples

**Files modified**:
- `src/app/api/storybookV2/exemplars/route.ts` - Fixed early return condition
- `src/app/api/storybookV2/images/route.ts` - Added concurrent generation guard
- `src/ai/flows/story-image-flow.ts` - Fixed buildActorData and improved prompt instructions

---

#### `685f2a0` - Display imageUrl in AI flow logs and add pagination

**Type**: Enhancement

**Summary**: The AI flow logs admin page now displays generated images inline and supports pagination with a "Load More" button.

**Changes**:
- Added `imageUrl` field to `AIFlowLog` TypeScript type (was already being stored in Firestore)
- Admin AI logs page now displays the generated image when `imageUrl` is present
- Replaced real-time listener with paginated loading (50 logs per page)
- Added "Load More" button to fetch additional logs
- Shows count of displayed logs and indicates when all logs are shown

**Files modified**:
- `src/lib/types.ts` - Added `imageUrl` field to `AIFlowLog` type
- `src/app/admin/ai-logs/page.tsx` - Added image display and pagination

---

#### `64ca527` - Improve synopsis prompt to prevent truncated responses

**Type**: Fix

**Summary**: Updated the synopsis generation prompt to reduce truncated responses from Gemini. Added action trigger, positive framing for completion requirements, and explicit punctuation instruction.

**Changes**:
- Added "Now write the summary:" action trigger at the end of the prompt
- Changed negative instructions ("do not stop mid-sentence") to positive framing ("must be grammatically complete sentences")
- Added explicit "End with proper punctuation (period)" requirement
- Simplified and restructured prompt sections for clarity

**Files modified**:
- `src/ai/flows/story-compile-flow.ts` - Updated synopsis prompt in `generateSynopsis` function

---

### 2026-01-11

#### `33c6071` - Add imageUrl to AI flow logs for image generation

**Type**: Enhancement

**Summary**: All image generation flows now include the final uploaded image URL in their AI flow logs. This makes it easier to review generated images directly from the logs.

**Changes**:
- Added `imageUrl` parameter to `logAIFlow` function
- Updated all image generation flows to log the final image URL after upload:
  - `storyImageFlow` (including title and back cover images)
  - `actorExemplarFlow`
  - `characterAvatarFlow`
  - `avatarFlow`
  - `storyActorAvatarFlow`
  - `storyOutputTypeImageFlow`
  - `imageStyleSampleFlow`

**Files modified**:
- `src/lib/ai-flow-logger.ts` - Added `imageUrl` parameter
- `src/ai/flows/story-image-flow.ts` - Log with imageUrl after upload
- `src/ai/flows/actor-exemplar-flow.ts` - Log with imageUrl after upload
- `src/ai/flows/character-avatar-flow.ts` - Log with imageUrl after upload
- `src/ai/flows/avatar-flow.ts` - Log with imageUrl after upload
- `src/ai/flows/story-actor-avatar-flow.ts` - Log with imageUrl after upload
- `src/ai/flows/story-output-type-image-flow.ts` - Log with imageUrl after upload
- `src/ai/flows/image-style-sample-flow.ts` - Log with imageUrl after upload

---

#### `3133b9e` - Fix exemplars not being generated when actorExemplars is empty

**Type**: Bug fix

**Summary**: Fixed a bug where exemplar character reference sheets were not being generated if `exemplarGeneration.status` was already 'ready' but the `actorExemplars` mapping was empty. This could happen if exemplar generation had been marked complete but no actual exemplars were created.

**Root cause**: The condition to generate exemplars only checked if `exemplarGeneration.status !== 'ready'`, but didn't verify that `actorExemplars` actually contained entries.

**Fix**: Now also regenerates exemplars if status is 'ready' but `actorExemplars` is empty.

**Files modified**:
- `src/app/api/storybookV2/images/route.ts` - Updated condition to regenerate exemplars when mapping is empty

---

#### `2cad8c9` - Add exemplar character reference sheets for consistent character depiction

**Type**: Feature

**Summary**: Before generating storybook page images, the system now creates "exemplar" character reference sheets showing front, side, and back views of each actor in the selected art style. These reference sheets are used instead of individual photos, providing more consistent character appearance across all pages of the storybook.

**How it works**:
1. When storybook image generation starts, the system first generates an exemplar for each actor (child/character) in the story
2. Each exemplar is a single image showing the character from front, 3/4, and back views in the storybook's art style
3. Exemplars are cached per actor+style combination and reused across storybooks
4. If exemplar generation fails for any actor, the system falls back to the previous approach (using photos/avatars)

**Benefits**:
- More consistent character appearance across all pages of a storybook
- Reduced token usage (one exemplar image instead of multiple photos)
- Characters appear in the art style from the start (not adapted from photos each time)

**Data Model**:
- New `exemplars` collection stores generated character reference sheets
- `StoryBookOutput.exemplarGeneration` tracks exemplar generation status
- `StoryBookOutput.actorExemplars` maps actorId → exemplarId

**Files created**:
- `src/ai/flows/actor-exemplar-flow.ts` - Genkit flow for generating exemplar images
- `src/app/api/storybookV2/exemplars/route.ts` - API endpoint to orchestrate exemplar generation

**Files modified**:
- `src/lib/types.ts` - Added `ActorExemplar` type, updated `StoryBookOutput`
- `src/ai/flows/story-image-flow.ts` - Accept and use exemplar images in prompts
- `src/app/api/storybookV2/images/route.ts` - Generate exemplars before page images
- `docs/SCHEMA.md` - Document new `exemplars` collection

---

#### `e65512b` - Differentiate AI flow log names for cover images

**Type**: Improvement

**Summary**: Image generation for title/front cover and back cover pages now log with distinct flow names in AIFlowLog for easier identification and debugging.

**Changes**:
- Front cover (`cover_front`) images log as `storyImageFlow:createTitleImage`
- Back cover (`cover_back`) images log as `storyImageFlow:createBackImage`
- Content page images continue to log as `storyImageFlow:createImage`

**Files modified**:
- `src/ai/flows/story-image-flow.ts`

---

### 2026-01-09

#### `5ac7334` - Show placeholder and disable continue while character avatar generates

**Type**: UX Improvement

**Summary**: When a new character is introduced during story creation, the UI now shows a "?" icon placeholder and disables the Continue button until the character's avatar has been generated.

**Changes**:
- Avatar placeholder shows a `HelpCircle` (?) icon instead of a loading spinner
- "Creating avatar..." badge now includes a small spinning loader
- Continue button is disabled until avatar is ready
- Added helper text explaining the wait
- Added `requireAvatarForContinue` prop (defaults to true) for flexibility

**Files modified**:
- `src/components/story/character-introduction-card.tsx` - Updated avatar fallback and continue button logic

---

#### `9d3122a` - Fix audio generation not completing on serverless

**Type**: Bug Fix

**Summary**: Audio generation was failing silently on Firebase App Hosting because the fire-and-forget Promise pattern doesn't work reliably on serverless - the function can terminate before background work completes.

**Changes**:
- Replaced fire-and-forget Promise pattern with Next.js `after()` API
- The `after()` callback keeps the serverless function alive until audio generation completes
- Added character limit handling (5,000 chars) for ElevenLabs API
- Added more detailed logging throughout the audio flow

**Files modified**:
- `src/app/api/storyBook/audio/route.ts` - Use `after()` instead of floating Promise
- `src/ai/flows/story-audio-flow.ts` - Add character limit handling and improved logging

---

#### `d1378c3` - Fix synopsis generation producing truncated output

**Type**: Bug Fix

**Summary**: Synopsis generation was producing truncated responses like "Ezra and his" instead of complete sentences.

**Changes**:
- Created centralized `generateSynopsis()` helper function in story-compile-flow.ts
- Improved prompt with explicit completion requirements and example format
- Increased maxOutputTokens from 150 to 200
- Added validation to detect and handle truncated responses
- Added fallback for responses that don't end with proper punctuation
- Consolidated 3 duplicate synopsis generation blocks into single helper

**Files modified**:
- `src/ai/flows/story-compile-flow.ts` - Added generateSynopsis helper, refactored friends/wizard/gemini synopsis generation

---

#### `175aefc` - Fix storyMode not being set for wizard stories

**Type**: Bug Fix

**Summary**: Wizard-generated stories were failing to compile because the `storyMode` field was not being set on the session or story document. This caused the storyCompile flow to skip the wizard-specific path and fall through to the standard path which requires `storyTypeId` (which wizard sessions don't have).

**Root Cause**:
1. Session creation at `/story/start/wizard/page.tsx` did not include `storyMode: 'wizard'`
2. Story creation in `story-wizard-flow.ts` did not include `storyMode: 'wizard'`

**Impact**: For wizard-generated stories:
- Synopsis was not being generated (compile failed before reaching synopsis generation)
- No aiFlowLog for synopsis (compile failed before calling the AI)
- Cast avatar was not generated (compile failed before setting up actor avatar generation)
- Story card did not display the story generator type

**Fix**:
- Added `storyMode: 'wizard'` to session creation in wizard start page
- Added `storyMode: 'wizard'` to story payload in wizard flow

**Files modified**:
- `src/app/story/start/wizard/page.tsx` - Added storyMode to session creation
- `src/ai/flows/story-wizard-flow.ts` - Added storyMode to story payload

---

### 2026-01-08

#### `cd60d41` - Fix intermittent actor resolution in image generation

**Type**: Bug Fix

**Summary**: Fixed an intermittent issue where actors (children/characters) referenced in story pages were not being found during image generation. The image generation prompt would show only one actor (the main child) when multiple actors should have been included.

**Root Cause**: The `fetchEntityReferenceData` function used sequential queries - first checking the `characters` collection, then only checking `children` for IDs not found in characters. This sequential approach was unreliable and occasionally failed to find valid actors.

**Fix**: Aligned the query strategy with `story-page-flow.ts` by querying BOTH collections in parallel for ALL IDs:
- Uses `doc(id).get()` for each ID in both collections simultaneously
- More robust against intermittent Firestore issues
- Adds `safeGet` helper to gracefully handle invalid IDs

**Also fixed**:
- `fetchEntityAvatarsOnly` - same parallel query approach for back cover generation
- Child age now shows in months for children under 2 years (e.g., "8 months old" instead of "0 years old")

**Files modified**:
- `src/ai/flows/story-image-flow.ts` - Rewritten `fetchEntityReferenceData` and `fetchEntityAvatarsOnly` functions, improved age calculation

---

#### `8402c2b` - Persist music preference for children

**Type**: Feature

**Summary**: The "music off" setting now persists for each child. Previously, the music preference reset every time a child entered a new story generator flow.

**Changes**:
- Added `musicEnabled` field to `ChildProfile` type (defaults to `true` if not set)
- `StoryBrowser` component now:
  - Initializes music state from child profile
  - Syncs music state when child profile loads
  - Persists music preference to Firestore when toggled
- Updated SCHEMA.md with new field documentation

**Files modified**:
- `src/lib/types.ts` - Added `musicEnabled` field to `ChildProfile`
- `src/components/story/story-browser.tsx` - Read/write music preference
- `docs/SCHEMA.md` - Document new field

---

#### `a208953` - Fix storyCompileFlow overwriting unresolved story text

**Type**: Bug Fix

**Summary**: The story compile flow was saving resolved story text (with display names) to the database instead of preserving the unresolved text (with `$$id$$` placeholders). This broke downstream processes like pagination and image generation which need to extract entity IDs from placeholders.

**Root Cause**: In `story-compile-flow.ts`, multiple code branches were saving `resolvedStoryText` to the `storyText` field:
- Friends mode was updating the story document with resolved text
- Gemini mode was creating the story document with resolved text
- Standard/chat mode was creating the story document with resolved text

**Fix**:
- Friends mode: Removed the `storyText` update entirely (the friends-flow already saved unresolved text)
- Gemini mode: Changed to save `geminiFinalStory` (unresolved) instead of `resolvedStoryText`
- Standard mode: Changed to save `rawStoryText` (unresolved) instead of `resolvedStoryText`

**Impact**: After this fix, the `storyText` field in the `stories` collection will contain text with `$$id$$` placeholders, which is required for:
- Page generation to extract entity IDs for each page
- Pagination flow to understand which characters appear on each page
- Image generation to know which characters to include in images

**Files modified**:
- `src/ai/flows/story-compile-flow.ts`

---

#### `8e98d04` - Add ElevenLabs API version selection

**Type**: Feature

**Summary**: Added ability to switch between ElevenLabs TTS model versions (v2 and v3) from the admin diagnostics page. V3 is the new expressive model with enhanced emotional range; v2 is the stable multilingual model.

**Changes**:
- Added `elevenLabsApiVersion` field to `DiagnosticsConfig` type (`'v2'` or `'v3'`)
- Default set to `v3` (eleven_v3 - latest expressive model)
- Added dropdown selector in Admin Dashboard > Diagnostics & Logging
- Created `src/lib/get-elevenlabs-config.server.ts` helper for server-side config access
- Updated all TTS routes and AI flows to use dynamic model selection:
  - `src/app/api/tts/route.ts`
  - `src/app/api/voices/preview/route.ts`
  - `src/ai/flows/story-audio-flow.ts`
  - `src/ai/flows/story-page-audio-flow.ts`
- Updated `src/lib/tts-config.ts` with `ELEVENLABS_MODELS` constant and `getElevenLabsModel()` helper

**Files modified**:
- `src/lib/types.ts`
- `src/lib/tts-config.ts`
- `src/hooks/use-diagnostics.tsx`
- `src/app/admin/page.tsx`
- `src/app/api/tts/route.ts`
- `src/app/api/voices/preview/route.ts`
- `src/ai/flows/story-audio-flow.ts`
- `src/ai/flows/story-page-audio-flow.ts`
- `docs/SCHEMA.md`

**Files created**:
- `src/lib/get-elevenlabs-config.server.ts`

---

#### `e774269` - Add server-side storybook creation API

**Type**: Feature

**Summary**: Added new API endpoint for creating StoryBookOutput documents server-side. This moves print layout lookup and image dimension calculation from client to server, ensuring consistent behavior across PWA and mobile app.

**Changes**:
- **New API endpoint**: `POST /api/storybookV2/create`
  - Validates ownership (story belongs to authenticated user)
  - Looks up print layout dimensions from the output type
  - Creates StoryBookOutput document with proper initialization
  - Returns `{ ok: true, storybookId: string }`
- **Updated PWA**: `/kids/create/[sessionId]/style` now uses API client instead of direct Firestore writes
- **Updated API client** (`@storypic/api-client`):
  - Added `createStorybook(storyId, outputTypeId, styleId, imageStylePrompt)` method
- **Updated mobile app**: Updated `createStorybook` method to properly parse response
- **Updated shared-types**: Added `StorybookCreateRequest` and `StorybookCreateResponse` types

**Files Modified**:
- `src/app/api/storybookV2/create/route.ts` (new)
- `src/app/kids/create/[sessionId]/style/page.tsx`
- `packages/api-client/src/client.ts`
- `packages/shared-types/src/index.ts`
- `mobile/src/contexts/ApiClientContext.tsx`
- `docs/API.md`

---

#### `e99e7fd` - Refactor PWA kids routes to use API endpoints

**Type**: Refactoring

**Summary**: Refactored all PWA `/kids/*` routes to use the same API endpoints as the mobile app, following the server-first data processing principle. This ensures both clients (mobile and PWA) use identical APIs, and all business logic (filtering, sorting, placeholder resolution) happens on the server.

**Changes**:
- **New API endpoints**:
  - `GET /api/storyOutputTypes` - Returns live output types, sorted alphabetically
  - `GET /api/imageStyles` - Returns image styles, sorted with preferred first
- **Enhanced API endpoints**:
  - `GET /api/stories` - Now includes `titleResolved`, `synopsisResolved`, and `actors` array with resolved profiles
  - `GET /api/stories/[storyId]` - Now includes `titleResolved`, `synopsisResolved`, `storyTextResolved`, and `actors` array
- **Refactored PWA routes**:
  - `/kids/story/[storyId]/read` - Uses `apiClient.getStory()` for story with resolved text
  - `/kids/read/[bookId]` - Uses `apiClient.getStorybookPages()` for pages
  - `/kids/stories` - Uses `apiClient.getMyStories()` for stories list with resolved text
  - `/kids/books` - Uses `apiClient.getMyStories()`, `apiClient.getMyStorybooks()`, `apiClient.getOutputTypes()`, `apiClient.getImageStyles()`
- **API client updates** (`@storypic/api-client`):
  - Added working implementations for `getOutputTypes()`, `getImageStyles()`
  - Added working implementations for `getStory()`, `getMyStories()`, `getMyStorybooks()`, `getStorybookPages()`
- **Removed from PWA**: Direct Firestore queries, client-side placeholder resolution, client-side actor loading

**Technical Debt Resolved**: PWA kids routes no longer use direct Firestore queries - they now use the same API endpoints as the mobile app.

**Files Created**:
- `src/app/api/storyOutputTypes/route.ts`
- `src/app/api/imageStyles/route.ts`

**Files Modified**:
- `src/app/api/stories/route.ts` (added placeholder resolution and actors)
- `src/app/api/stories/[storyId]/route.ts` (added placeholder resolution and actors)
- `packages/api-client/src/client.ts` (implemented new methods)
- `src/app/kids/story/[storyId]/read/page.tsx` (refactored to use API)
- `src/app/kids/read/[bookId]/page.tsx` (refactored to use API)
- `src/app/kids/stories/page.tsx` (refactored to use API)
- `src/app/kids/books/page.tsx` (refactored to use API)
- `docs/API.md` (documented new endpoints)

---

#### `ea39e67` - Implement server-first data processing architecture

**Type**: Architecture

**Summary**: Implemented server-first data processing principle to ensure clients are thin and only responsible for rendering data. All filtering, sorting, and business logic is now done on the server side. This allows backend changes to apply to all clients (mobile, PWA) without requiring client updates.

**Changes**:
- **Storybooks API** (`/api/stories/[storyId]/storybooks`): Now filters to only return storybooks with `imageGeneration.status === 'ready'` by default. Added `?includeAll=true` query param to override.
- **Pages API** (`/api/stories/[storyId]/storybooks/[storybookId]/pages`): Now filters out blank and title_page pages server-side (these are for print only, not reading).
- **Mobile app**: Removed client-side filtering for storybooks and pages - now trusts server to return correct data.
- **CLAUDE.md**: Added new "Architectural Principles" section documenting the server-first data processing rule with guidelines and examples.
- **API.md**: Documented the new API endpoints with server-side filtering behavior.

**Technical Debt Note**: The PWA kids routes (`/kids/*`) still use direct Firestore queries from the client. These should be refactored to use API endpoints like the mobile app.

**Files Modified**:
- `src/app/api/stories/[storyId]/storybooks/route.ts` (added ready status filtering)
- `src/app/api/stories/[storyId]/storybooks/[storybookId]/pages/route.ts` (added blank/title_page filtering)
- `mobile/app/story/[storyId].tsx` (removed client-side filtering)
- `mobile/app/book/[storyId].tsx` (removed client-side filtering)
- `CLAUDE.md` (added Architectural Principles section)
- `docs/API.md` (documented new API endpoints)

---

### 2026-01-07

#### `c206f28` - Add imageDescription auto-generation for child/character photos

**Type**: Feature

**Summary**: When photos are uploaded to a child or character profile, an AI flow now automatically generates a text description of their physical appearance (hair color, eye color, skin tone, distinctive features). This `imageDescription` field is used in storybook image generation prompts as a text-based fallback when photos cannot be used directly (e.g., too many images trigger copyright filters).

**Changes**:
- Added `imageDescription` and `imageDescriptionGeneration` fields to ChildProfile and Character types
- Created `imageDescriptionFlow` Genkit flow that analyzes photos and generates appearance descriptions
- Avatar generation flows now trigger image description generation in background
- Photo upload APIs trigger image description generation on every upload
- Added `/api/regenerate-image-description` endpoint for manual regeneration
- EntityEditor now calls regenerate API when photos are removed
- Story image flow now includes `imageDescription` in actor data for prompts

**Files Created**:
- `src/ai/flows/image-description-flow.ts`
- `src/app/api/regenerate-image-description/route.ts`

**Files Modified**:
- `src/lib/types.ts` (added imageDescription fields to ChildProfile and Character)
- `src/ai/flows/avatar-flow.ts` (trigger imageDescriptionFlow)
- `src/ai/flows/character-avatar-flow.ts` (trigger imageDescriptionFlow)
- `src/app/api/children/photos/route.ts` (trigger on upload)
- `src/app/api/characters/photos/route.ts` (trigger on upload)
- `src/components/shared/EntityEditor.tsx` (call regenerate on photo removal)
- `src/ai/flows/story-image-flow.ts` (include imageDescription in ActorData)
- `docs/SCHEMA.md` (document new fields)
- `docs/API.md` (document new endpoint)

---

#### `f8656fd` - Add API client packages for mobile development

**Type**: Architecture / Infrastructure

**Summary**: Created shared packages to support future mobile client development. This implements Phase A (PWA Separation) of the mobile client development plan, establishing the foundation for Android and iOS apps.

**Changes**:
- Created `@storypic/shared-types` package with TypeScript types for API contracts
- Created `@storypic/api-client` package with typed HTTP client for child-facing features
- Added npm workspaces configuration to root package.json
- Created `ApiClientProvider` React context for injecting API client
- Integrated API client into kids PWA layout
- Updated `next.config.ts` with `transpilePackages` for workspace packages
- Updated `turbopack.root` configuration to resolve workspace correctly

**Files Created**:
- `packages/shared-types/package.json`
- `packages/shared-types/tsconfig.json`
- `packages/shared-types/src/index.ts`
- `packages/api-client/package.json`
- `packages/api-client/tsconfig.json`
- `packages/api-client/src/index.ts`
- `packages/api-client/src/client.ts`
- `src/contexts/api-client-context.tsx`

**Files Modified**:
- `package.json` (added workspaces)
- `next.config.ts` (added transpilePackages, turbopack.root)
- `src/app/kids/layout.tsx` (added ApiClientProvider)
- `docs/SYSTEM_DESIGN.md`
- `docs/API.md`

---

#### `f0f5510` - Add additional prompt option for image regeneration

**Type**: Feature

**Summary**: Parents can now add optional instructions when regenerating a storybook page image. When clicking "Regenerate this page" in the storybook viewer, a dialog appears allowing the user to provide additional guidance to the AI (e.g., "make the background more colorful", "show the character smiling").

**Changes**:
- Added `additionalPrompt` field to story-image-flow input schema
- Added `additionalPrompt` parameter to `/api/storybookV2/images` API route
- Created regenerate dialog in storybook viewer with textarea for instructions
- Additional prompt is appended to the scene description in the AI prompt

**Files Modified**:
- `src/ai/flows/story-image-flow.ts`
- `src/app/api/storybookV2/images/route.ts`
- `src/app/storybook/[bookId]/page.tsx`
- `docs/API.md`

---

#### `bd8efbf` - Fix storyCompile error for friends story mode

**Type**: Bug Fix

**Summary**: Stories created with "Fun with Friends" were failing to compile with the error "Session is missing childId, storyTypeId, or parentUid" because the storyCompileFlow didn't handle `storyMode: 'friends'`.

**Root Cause**: The friends flow creates sessions with `storyMode: 'friends'` but no `storyTypeId`. The storyCompileFlow had handlers for `wizard`, `gemini3`, and `gemini4` modes, but fell through to the standard compilation path for `friends` mode, which requires `storyTypeId`.

**Changes**:
- Added `isFriendsMode` check to storyCompileFlow
- Friends mode handler mirrors wizard mode: loads existing story document, resolves placeholders, generates synopsis if missing, updates story with generation statuses for background tasks

**Files Modified**:
- `src/ai/flows/story-compile-flow.ts`

---

#### `4579a27` - Add delete photo button to child photo management

**Type**: Feature

**Summary**: Parents can now delete photos from a child's profile in the Manage Photos dialog.

**Changes**:
- Added `handleDeletePhoto` function with optimistic updates
- Added red "Delete" button to photo hover overlay alongside "Set as Avatar"
- Buttons now stack vertically in the overlay

**Files Modified**:
- `src/app/parent/children/page.tsx`

---

#### `1565866` - Split admin page into Admin, Writer, and Development

**Type**: Refactor

**Summary**: Split the monolithic `/admin` page into three separate role-based pages to improve organization and access control.

**Changes**:
- Created `/writer` page for content creation tools (accessible to Writers and Admins)
- Created `/admin/dev` page for testing and development tools (Admin only)
- Refactored `/admin` page to contain only operational/admin items (Admin only)
- Updated header navigation: Admins see "Admin" link, Writers see "Writer" link
- Updated dropdown menu: Admins see both Admin and Writer dashboards, Writers see only Writer dashboard
- Removed redundant items from all pages: Children, Characters, Story Sessions, Parent Settings, Story Flow Selection

**Page Assignments**:
- **Admin** (`/admin`): Users, Print Orders, Deleted Items, AI Flow Logs, Database Manager, Upload JSON Configs, Email Configuration, Diagnostics & Logging
- **Writer** (`/writer`): Story Editor (Types, Phases, Prompts, Outputs), Output Configuration (Image Styles, Print Layouts, Print Products), AI Prompts, Story Generators, Voice Config, Help Wizards
- **Development** (`/admin/dev`): AI Flow Tests (Story Beat/Arc/Compile/Pagination), Run Traces, Regression Tests, Firestore Rules Tests, Create Data, Seed Generators

**Files Created**:
- `src/app/writer/page.tsx` - New Writer dashboard
- `src/app/admin/dev/page.tsx` - New Development page

**Files Modified**:
- `src/app/admin/page.tsx` - Refactored to Admin-only items
- `src/components/header.tsx` - Updated navigation for role-based links

---

### 2026-01-06

#### `72f29f8` - Use generated sample as style example fallback

**Type**: Enhancement

**Summary**: When an image style has no manually uploaded example images, the generated sample image (`sampleImageUrl`) is now used as a style reference for image generation.

**Changes**:
- Added fallback in `story-image-flow.ts` to use `sampleImageUrl` when `exampleImages` array is empty
- Priority order: manually uploaded exampleImages > generated sampleImageUrl

**Files Modified**:
- `src/ai/flows/story-image-flow.ts` - Added sampleImageUrl fallback for style examples

---

#### `c2e8c73` - Fix duplicate actor information in image prompts

**Type**: Bug fix

**Summary**: Image prompts for covers were including actor details twice - once from the prompt builder functions in `story-page-flow.ts` and again from the structured JSON builder in `story-image-flow.ts`.

**Changes**:
- Simplified `buildImagePrompt`, `buildFrontCoverImagePrompt`, and `buildBackCoverImagePrompt` to only return scene descriptions
- Actor details are now added exclusively by `story-image-flow.ts` via `buildActorsJson` for all page types
- Removed unused helper functions: `buildActorBlock`, `buildCharacterDetails`, `getChildAgeYears`

**Files Modified**:
- `src/ai/flows/story-page-flow.ts` - Simplified prompt builders, removed duplicate actor info

---

#### `63de692` - Add errorMessage placeholders to maintenance email template

**Type**: Enhancement

**Summary**: Added `{{errorMessage}}` and `{{errorMessageSnippet}}` placeholders to the maintenance error email template for use in subject lines or body text.

**Changes**:
- `{{errorMessage}}` - The full error message
- `{{errorMessageSnippet}}` - First 5 words followed by ellipsis (e.g., "Failed to generate image for...")

**Files Modified**:
- `src/lib/email/templates.ts` - Added errorMessage and errorMessageSnippet to template values
- `docs/SCHEMA.md` - Documented new placeholders

---

#### `0b4b21c` - Add story progress indicator

**Type**: Feature

**Summary**: Story generators now return a `progress` value (0.0 to 1.0) with each response, and the UI displays a test tube progress indicator that fills with glowing liquid as the story progresses.

**Changes**:
1. Added `progress` field to `StoryGeneratorResponse` type
2. All story generator flows now calculate and return progress:
   - `storyBeat`: Based on arc step completion (arcStepIndex / totalSteps)
   - `gemini3`: Based on message count / target messages (storyTemperature)
   - `gemini4`: Based on question count / maxQuestions (6 for young kids, 8 for older)
   - `storyWizard`: Based on answered questions (0-0.8) with 1.0 when complete
   - `storyFriends`: Based on phase (character=0.25, scenario=0.5, synopsis=0.75, complete=1.0)
3. Created `TestTubeIndicator` component with:
   - SVG test tube with cork and glass effects
   - Glowing liquid that fills from bottom to top
   - Animated bubbles during generation
   - Smooth transitions between progress states
   - Three size variants (sm, md, lg)
4. Integrated progress indicator into `StoryBrowser`:
   - Fixed position on right side of screen (hidden on mobile)
   - Shows during active story creation phases
   - Bubbles animate only during generation

**Files Created**:
- `src/components/story/progress-indicators/test-tube-indicator.tsx`
- `src/components/story/progress-indicators/index.ts`

**Files Modified**:
- `src/lib/types.ts` - Added progress field to StoryGeneratorResponse
- `src/ai/flows/story-beat-flow.ts` - Added progress calculation
- `src/ai/flows/gemini3-flow.ts` - Added progress calculation
- `src/ai/flows/gemini4-flow.ts` - Added progress calculation
- `src/app/api/storyBeat/route.ts` - Pass through progress field
- `src/app/api/gemini3/route.ts` - Pass through progress field
- `src/app/api/gemini4/route.ts` - Pass through progress field
- `src/app/api/storyWizard/route.ts` - Calculate and return progress
- `src/app/api/storyFriends/route.ts` - Return progress for each phase
- `src/components/story/story-browser.tsx` - Added progress state and indicator
- `docs/API.md` - Documented StoryGeneratorResponse progress field

---

#### `938fd47` - Update /kids book reader to use ImmersivePlayer

**Type**: Enhancement

**Summary**: The /kids/read page now uses the shared ImmersivePlayer component, bringing it to feature parity with the main storybook reader. Also added manual navigation buttons to both read modes in ImmersivePlayer.

**Changes**:
- Rewrote `/kids/read/[bookId]` to use `ImmersivePlayer` instead of custom implementation
- Kids now see the same "Read to Me" / "Read Myself" mode selection as the main app
- Added manual navigation buttons (prev/next) to ImmersivePlayer for both modes
  - In "Read to Me" mode: buttons stop current audio before navigating
  - In "Read Myself" mode: buttons work as before
- Added exit button (BookOpen icon) visible in both modes
- Navigation buttons are semi-transparent circles on left/right sides of screen

**Files Modified**:
- `src/app/kids/read/[bookId]/page.tsx` - Simplified to use ImmersivePlayer
- `src/components/book-reader/immersive-player.tsx` - Added navigation buttons for both modes

---

#### `0d16972` - Fix /kids endpoint parity with /child routes

**Type**: Bug Fix / Security

**Summary**: The /kids PWA routes were not properly filtering and displaying story generators, and had a security gap in story ownership verification.

**Issues Fixed**:
1. `/kids/create` was fetching from hardcoded `systemConfig/kidsFlows` instead of the `storyGenerators` collection
2. `/kids/read/[bookId]` was missing the child ownership verification that `/child/[childId]/story/[storyId]/read` has
3. Story generators on /kids weren't respecting `status`, `enabledForKids`, or `order` fields

**Changes**:
- Created `/api/kids-generators` endpoint to fetch story generators from `storyGenerators` collection
  - Filters: `status === 'live'` AND `enabledForKids === true`
  - Sorts by `order` field then by name
- Rewrote `/kids/create` page to use the new API endpoint
  - Dynamically displays generator cards with name, description, icon, and gradient from the database
  - Removes hardcoded flow types (wizard, chat, gemini3, gemini4)
- Added story ownership security check to `/kids/read/[bookId]` page
  - Verifies `story.childId === childId` before displaying content
- Updated API.md with new endpoint documentation
- Marked `/api/kids-flows` as deprecated in docs

**Files Created**:
- `src/app/api/kids-generators/route.ts`

**Files Modified**:
- `src/app/kids/create/page.tsx`
- `src/app/kids/read/[bookId]/page.tsx`
- `docs/API.md`

---

#### `74f7409` - Add "Read Myself" mode to storybook player

**Type**: Feature

**Summary**: Children can now choose between "Read to Me" (narrated audio) or "Read Myself" (self-paced reading) when opening a completed storybook.

**Changes**:
- Start screen now shows two buttons: "Read to Me" and "Read Myself"
- "Read to Me" mode: Audio narration with auto-advance (existing behavior)
- "Read Myself" mode:
  - No audio playback
  - Previous/Next navigation buttons on screen edges
  - Keyboard navigation: any key advances to next page
  - Left arrow / Up arrow goes to previous page
  - Escape key exits to books list
  - Tapping anywhere on the screen advances to next page
- Added `ReadMode` type exported from book-reader components
- ImmersivePlayer now accepts `defaultReadMode` and `onReadModeChange` props

**Files Modified**:
- `src/components/book-reader/immersive-player.tsx` - Added read mode selection and navigation
- `src/components/book-reader/index.ts` - Export ReadMode type

---

### 2026-01-05

#### `a2e549d` - Add status filter tabs to parent print orders page

**Type**: Enhancement

**Summary**: The parent's Print Orders page (/parent/orders) now groups orders by status using filter tabs, matching the admin print orders page functionality.

**Changes**:
- Added status filter tabs: All, Pending, In Progress, Completed, Cancelled
- Each tab shows a count badge with the number of orders in that category
- Orders are grouped by fulfillment status into categories:
  - Pending: draft, validating, validation_failed, ready_to_submit, awaiting_approval
  - In Progress: approved, submitting, submitted, confirmed, in_production
  - Completed: shipped, delivered
  - Cancelled: cancelled, failed
- Empty state message is now filter-aware

**Files Modified**:
- `src/app/parent/orders/page.tsx` - Added tabs, filtering, and counts

---

#### `bb0b097` - Fix Story Beat showing blank completion page

**Type**: Bug Fix

**Summary**: The Story Beat generator was showing a blank "Your story is complete" page instead of displaying the compiled story text like other generators do.

**Root Cause**: The `autoCompileStory` function in StoryBrowser called the `/api/storyCompile` endpoint but never captured the `storyText` from the response to display in the completion UI. Other generators (Friends, Wizard) return `finalStory` in their API response which gets set directly, but Story Beat uses auto-compilation which didn't populate the `finalStory` state.

**Changes**:
- Updated `autoCompileStory` in story-browser.tsx to set `finalStory` from the compile response
- Now when compilation succeeds, the completed story text displays in the completion card

**Files Modified**:
- `src/components/story/story-browser.tsx` - Set finalStory from storyCompile result

---

#### `6958b56` - Add voice cloning API and configurable recording script

**Type**: Feature

**Summary**: Implemented the missing `/api/voices/clone` API for creating family voice clones with ElevenLabs Instant Voice Cloning. Parents can now record their voice and create a custom narrator voice for their children's stories. Also added a configurable recording script that admins can customize.

**Changes**:
- Created `/api/voices/clone` API route with GET (list), POST (create), DELETE operations
- Uses ElevenLabs IVC (Instant Voice Cloning) API to create voice clones
- Audio samples stored in Firebase Storage at `users/{uid}/voice-samples/`
- Voice metadata stored in Firestore at `users/{uid}/voices/{voiceId}`
- Automatic cleanup: deleting a voice removes it from ElevenLabs, Storage, and Firestore
- Children using a deleted voice are automatically switched to the default voice
- Added configurable voice recording script via `/admin/voice-config`
- Recording script displayed in a proper scrollable pane (fixed height with ScrollArea)

**Files Created**:
- `src/app/api/voices/clone/route.ts` - Voice cloning API (GET/POST/DELETE)
- `src/app/api/admin/system-config/voice/route.ts` - API for voice config
- `src/app/admin/voice-config/page.tsx` - Admin UI for editing script

**Files Modified**:
- `src/lib/types.ts` - Added VoiceConfig type and default recording text
- `src/components/parent/VoiceSelector.tsx` - Simplified recording script display with proper ScrollArea
- `src/app/admin/page.tsx` - Added Voice section with link to config
- `docs/SCHEMA.md` - Added systemConfig/voice documentation
- `docs/API.md` - Added voice clone and config endpoints

---

#### `54033b0` - Display story generator name on story cards

**Type**: Feature

**Summary**: Story cards now display the name of the generator used to create each story. This works for both legacy stories (with hardcoded mode names) and new stories created with dynamic generators.

**Changes**:
- Changed `storyMode` type from union to `string` for dynamic generator support
- Updated dynamic start page to set `storyMode` to the generator ID for all generators
- Added `storyModeName` prop to StoryCard component
- Stories page now fetches generator names and passes them to StoryCard
- StoryCard prefers passed-in generator name, falls back to legacy hardcoded labels
- Updated SCHEMA.md with new storyMode documentation

**Files Modified**:
- `src/lib/types.ts` - Changed storyMode to string type
- `src/app/story/start/[generatorId]/page.tsx` - Set storyMode for all generators
- `src/components/child/story-card.tsx` - Added storyModeName prop
- `src/app/child/[childId]/stories/page.tsx` - Fetch generators and pass names
- `docs/SCHEMA.md` - Updated storyMode field documentation

---

#### `cda6f8d` - Add order field to StoryGenerator for display ordering

**Type**: Feature

**Summary**: Story generators now have an `order` field that controls their display order on story creation pages. Lower numbers appear first.

**Changes**:
- Added `order` field to StoryGenerator type (optional, default 0)
- Updated admin storyGenerators page with order input field
- Admin list now sorts by order, then name
- Updated /story/start page to sort by order instead of hardcoded PREFERRED_ORDER array
- Updated SCHEMA.md documentation

**Files Modified**:
- `src/lib/types.ts` - Added order field
- `src/app/admin/storyGenerators/page.tsx` - Added order editor and sorting
- `src/app/story/start/page.tsx` - Updated sorting logic
- `docs/SCHEMA.md` - Added order field documentation

---

#### `0d2cc6f` - Add detailed error wrapping to images API route

**Type**: Debugging

**Summary**: Added try-catch wrappers around Firestore operations in the images API route to provide clearer error messages identifying exactly where "documentPath must be non-empty" errors occur.

**Changes**:
- Wrap storybook fetch in try-catch with descriptive error
- Wrap print layout fetch in try-catch (non-fatal)
- Wrap loadPages in try-catch with descriptive error

**Files Modified**:
- `src/app/api/storybookV2/images/route.ts`

---

#### `3c61194` - Add upfront validation for document IDs in image flow

**Type**: Enhancement / Debugging

**Summary**: Added early validation of storyId, pageId, and storybookId at the start of storyImageFlow to catch invalid/empty IDs before any Firestore calls, providing clearer error messages to help diagnose "documentPath must be non-empty string" errors.

**Changes**:
- Validate all document IDs before initializing Firestore
- Return descriptive error messages identifying which specific ID is invalid
- Helps diagnose where empty IDs originate from

**Files Modified**:
- `src/ai/flows/story-image-flow.ts` - Added upfront ID validation

---

#### `3c4433e` - Fix unresolved placeholders in story synopsis

**Type**: Bug Fix

**Summary**: The synopsis generated by story-synopsis-flow (after story compilation) was showing unresolved `$$id$$` placeholders. Now resolves placeholders before saving to Firestore.

**Root Cause**: The flow was generating a synopsis with `$$id$$` placeholders as instructed, but wasn't resolving them before saving. The synopsis is user-facing text and should display plain character names.

**Changes**:
- Build entityMap from loaded actors (with dual-key mapping for malformed placeholders)
- Call `replacePlaceholdersInText()` to resolve all placeholders before saving
- Added handling for literal `$$childId$$` placeholder

**Files Modified**:
- `src/ai/flows/story-synopsis-flow.ts` - Added placeholder resolution before save

---

#### `8ce294e` - Add git commit SHA to page generation diagnostics

**Type**: Enhancement

**Summary**: Added git commit SHA to all diagnostic outputs in story-page-flow, so when viewing diagnostics you can see which version of the code generated them.

**Changes**:
- Added `gitCommitSha` field to all diagnostic stages (init, loading, chunking, building_pages, done, error)
- Uses `NEXT_PUBLIC_GIT_COMMIT_SHA` environment variable set at build time

**Files Modified**:
- `src/ai/flows/story-page-flow.ts` - Added gitCommitSha to all diagnostics

---

#### `47e4714` - Fix conflicting prompt instructions causing placeholder leakage

**Type**: Bug Fix

**Summary**: Fixed scenarios and synopses still showing `$Dad$`, `$childId$` placeholder syntax because the global system prompt was overriding the scenario-specific instructions.

**Root Cause**: The `globalPrefix` (from systemConfig) instructs the AI to "use $$id$$ placeholders for ALL character references". This prefix was being prepended to ALL prompt types, including scenario and synopsis generation. However, those prompts explicitly say "use real names, no placeholders". The AI was following the globalPrefix instead of the prompt-specific instruction, causing placeholder syntax to leak into user-facing text.

**Solution**: Don't prepend `globalPrefix` for scenario and synopsis generation. The globalPrefix is only needed for story generation where we want `$$id$$` placeholders for later processing.

**Changes**:
- **handleScenarioGeneration**: Removed globalPrefix prepending, added explanatory comment
- **handleSynopsisGeneration**: Removed globalPrefix prepending, added explanatory comment
- Removed unused `globalPrefix` parameter from both functions
- **handleStoryGeneration**: Still uses globalPrefix (correctly) since story text needs placeholders

**Files Modified**:
- `src/ai/flows/friends-flow.ts` - Removed globalPrefix from scenario/synopsis prompts

---

#### `b793bab` - Fix malformed placeholder resolution in Friends flow

**Type**: Bug Fix

**Summary**: Fixed scenario and synopsis text still showing `$$Dad$$` and `$$childId$$` placeholders instead of resolved character names.

**Root Cause**: The entityMap used for placeholder resolution was keyed only by document ID (`abc123`), but when the AI outputs `$$Dad$$`, we were trying to look up "Dad" which didn't exist in the map.

**Changes**:
- **handleScenarioGeneration**: Build entityMap with BOTH document ID and displayName as keys
- **handleSynopsisGeneration**: Same fix - dual-key entityMap
- Added special handling for literal `$$childId$$` placeholder

**Files Modified**:
- `src/ai/flows/friends-flow.ts` - Fixed entityMap construction for both scenario and synopsis generation

---

#### `de05c67` - Fix "documentPath must be non-empty string" errors and improve diagnostics

**Type**: Bug Fix + Enhancement

**Summary**: Comprehensive fix for Firestore "documentPath must be non-empty string" errors across story generation flows, plus improved diagnostics to help debug entity resolution issues.

**Root Cause**: Multiple places in the codebase were passing entity IDs to Firestore without validating them first. This could happen when:
1. Empty strings in arrays were passed to `where('__name__', 'in', [...])` queries
2. `story.childId` was empty/undefined and used directly with `doc(childId)`
3. User-provided character selections weren't filtered before saving to Firestore

**Changes**:
1. **resolve-placeholders.server.ts**:
   - `fetchEntities`: Filter out empty/invalid IDs before Firestore queries
   - `resolveEntitiesInText`: Early return for empty text, filter extracted IDs

2. **story-synopsis-flow.ts**:
   - Validate `story.childId` before using in Firestore calls
   - Add warning log when childId is invalid/missing
   - Conditionally load child profile only if childId is valid

3. **friends-flow.ts**:
   - Filter user-provided `selectedCharacterIds` in confirm_characters action
   - Prevents empty strings from being saved to session.actors

4. **story-page-flow.ts** (diagnostics):
   - Added `storyActors` - raw actors array from story document
   - Added `allActorIds` - filtered actor IDs being used
   - Added `resolvedEntityList` - list of resolved entities with their IDs and displayNames
   - Helps identify malformed placeholders and empty ID issues

**Files Modified**:
- `src/lib/resolve-placeholders.server.ts` - Added defensive filtering
- `src/ai/flows/story-synopsis-flow.ts` - Added childId validation
- `src/ai/flows/friends-flow.ts` - Added character ID filtering
- `src/ai/flows/story-page-flow.ts` - Enhanced diagnostics

---

#### `5ab5e8e` - Fix unresolved placeholders in Friends flow scenarios/synopses

**Type**: Bug Fix

**Summary**: Fixed Friends flow showing raw `$$id$$` placeholders in scenario and synopsis options instead of resolved character names. Added placeholder resolution to both scenario and synopsis generation outputs.

**Root Cause**: The AI prompts instruct it to use plain names, but the AI sometimes still outputs `$$id$$` placeholder format. These placeholders weren't being resolved before returning to the client, causing the UI to display raw placeholders like `$$ezra-11t82b$$`.

**Changes**:
1. **handleScenarioGeneration**: Build entity map from loaded characters and resolve placeholders in scenario titles and descriptions before returning
2. **handleSynopsisGeneration**: Build entity map from loaded characters and resolve placeholders in synopsis titles and summaries before returning
3. Session now stores resolved text, ensuring consistent display even on page refresh

**Files Modified**:
- `src/ai/flows/friends-flow.ts` - Added placeholder resolution for scenarios and synopses

---

#### `72e1630` - Add story mode badges and fix AI Voice consistency

**Type**: Enhancement

**Summary**: Added visual badges to story cards showing which AI flow generated each story, and fixed inconsistent "AI Voice" badge display.

**Changes**:
1. **Added storyMode field to Story type**: Stories now store which AI flow generated them (wizard, gemini3, gemini4, chat, friends) for display purposes

2. **Updated story-compile-flow**: Copies storyMode from StorySession to Story document at compile time

3. **Fixed AI Voice badge**: Now shows consistently when audioUrl exists OR status is ready (was requiring both conditions)

4. **Added AI flow badge**: Story cards now display which generator created the story with labels:
   - wizard → "Quick Story"
   - gemini3 → "Adventure"
   - gemini4 → "Deep Story"
   - friends → "Friends"
   - chat → "Classic"

**Files Modified**:
- `src/lib/types.ts` - Added storyMode field to Story type
- `src/ai/flows/story-compile-flow.ts` - Copy storyMode from session to story
- `src/components/child/story-card.tsx` - Fixed audio badge, added flow badge
- `docs/SCHEMA.md` - Documented new storyMode field

**Note**: Existing stories won't have the storyMode field, so the badge will only appear on newly created stories.

---

#### `b4d0abc` - Fix image generation failing with invalid document path

**Type**: Bug Fix

**Summary**: Fixed image generation failing with "documentPath must be non-empty string" error. The root cause was the Fun with Friends flow saving resolved story text (with actual names) instead of unresolved text (with $$id$$ placeholders), which prevented entity extraction during page generation.

**Root Cause Analysis**:
The diagnostics showed `actorCount: 5` but `resolvedEntities: 0`. This happened because:
1. The AI generated story text with `$$childId$$` placeholders
2. The friends-flow resolved these to actual names before saving
3. When page generation ran, it found no `$$id$$` patterns to extract entityIds from
4. Image generation then had no way to identify which actors were on each page

**Changes**:
1. **Fixed friends-flow.ts**: Now saves unresolved storyText (with $$id$$ placeholders) so page generation can extract entityIds per page

2. **Added isValidDocumentId helper**: Added type-safe validation helper to both:
   - `src/app/api/storybookV2/images/route.ts`
   - `src/ai/flows/story-image-flow.ts`

3. **Hardened Firestore document ID validation**:
   - printLayoutId lookup now properly validates before use
   - childId lookup uses the new helper
   - imageStyleId lookup uses the new helper
   - Page ID validation uses the new helper for consistency

**Files Modified**:
- `src/ai/flows/friends-flow.ts` - Save unresolved storyText
- `src/app/api/storybookV2/images/route.ts` - Added isValidDocumentId, improved validation
- `src/ai/flows/story-image-flow.ts` - Added isValidDocumentId, improved validation

---

### 2026-01-04

#### `97a28c9` - Configurable AI model/temperature and inventive scenario prompts

**Type**: Feature

**Summary**: Added ability to configure AI model and temperature per generator and per prompt. Also significantly improved the scenario generation prompt to produce more imaginative adventure ideas.

**Key Features**:
1. **Configurable AI Settings**: Each generator can now have:
   - Default model (Gemini 2.5 Pro, Flash, or 2.0 Flash)
   - Default temperature (0.0-2.0)
   - Per-prompt model and temperature overrides

2. **Inventive Scenario Prompts**: Rewrote the friends flow scenario prompt to encourage wildly imaginative adventures (shrinking to ant-size, toys coming alive, rainbow bridges to dessert lands, etc.)

3. **Higher Default Temperature for Scenarios**: Increased default scenario generation temperature to 1.2 for more creative variety

**Admin UI**: New "AI Settings" tab in Story Generators admin page allows:
- Setting generator-wide default model and temperature
- Overriding model and temperature for each individual prompt

**Files Created/Modified**:
- `src/lib/types.ts` - Added `AIModelName`, `StoryGeneratorPromptConfig` types, extended `StoryGenerator`
- `src/ai/flows/friends-flow.ts` - Added `getModelConfig()` helper, improved scenario prompt
- `src/app/admin/storyGenerators/page.tsx` - Added AISettingsEditor component and AI Settings tab

**Documentation Updated**:
- `docs/SCHEMA.md` - Added new fields to storyGenerators collection

---

#### `b83dd18` - Fix friends flow option selection and "more synopses"

**Type**: Bug Fix

**Summary**: Fixed two issues with the friends flow in StoryBrowser:
1. Clicking "Show me different stories" (more synopses) was calling the wrong API, causing a 500 error
2. Selecting a scenario or synopsis option was calling the generic generator API instead of the friends API

**Root Cause**: The `handleSelectOption` function was using `callGeneratorAPI` for all options, but the friends flow requires `callFriendsAPI` which passes `selectedOptionId` and `action` parameters that the `/api/storyFriends` endpoint expects.

**Changes**:
- When in friends `synopsis_selection` phase and clicking `isMoreOption`, call `callFriendsAPI('more_synopses')`
- When in friends `scenario_selection` or `synopsis_selection` phase, call `callFriendsAPI(undefined, undefined, option.id)` for regular options

**Files Modified**:
- `src/components/story/story-browser.tsx` - Route friends flow options to correct API handler

---

#### `acf34ff` - Data-driven story generator routing

**Type**: Refactor

**Summary**: Replaced hardcoded generator routes with a data-driven approach. The `/story/start` page now queries the `storyGenerators` collection for available generators, and new dynamic routes handle any generator without requiring code changes. Adding a new generator now only requires: (1) adding to the storyGenerators collection (via seed or admin), (2) creating the AI flow and API route.

**Key Changes**:
- `/story/start` page now queries Firestore for generators with `status='live'` AND `enabledForKids=true`
- Created dynamic `/story/start/[generatorId]` route to start any generator session
- Created dynamic `/story/[generatorId]/[sessionId]` route to run any generator
- Added `enabledForKids` field to all generator seed configs (wizard, gemini3, gemini4, friends)
- Added deprecation notice to `/admin/kids-flows` page (replaced by generator-level enabledForKids toggle)
- "Enabled for Kids" toggle already exists in Story Generators admin page (General tab)
- Fixed: Friends flow scenario/synopsis options now show resolved character names instead of `$$id$$` placeholders

**Files Created**:
- `src/app/story/start/[generatorId]/page.tsx` - Dynamic start route for any generator
- `src/app/story/[generatorId]/[sessionId]/page.tsx` - Dynamic story session route

**Files Modified**:
- `src/app/story/start/page.tsx` - Refactored to query storyGenerators collection
- `src/app/api/admin/story-generators/seed/route.ts` - Added enabledForKids to wizard, gemini3, gemini4
- `src/app/admin/kids-flows/page.tsx` - Added deprecation warning
- `src/ai/flows/friends-flow.ts` - Use display names for scenario/synopsis prompts, placeholders only for final story

**Documentation Updated**:
- `docs/SCHEMA.md` - Added enabledForKids field to storyGenerators, updated description

---

#### `55aaebb` - Additional empty entityId filtering

**Type**: Bug Fix

**Summary**: Extended empty string filtering for entityIds to more locations to prevent Firestore "documentPath must be non-empty" errors during page and image generation.

**Changes**:
- Added filtering for `allActorIds` in story-page-flow (was previously unfiltered for cover pages)
- Added filtering for `pageEntityIds` in story-page-flow (AI pagination results could contain empty strings)
- Added filtering for `selectedIds` in friends-flow (3 locations)

**Files Modified**:
- `src/ai/flows/story-page-flow.ts` - Filter allActorIds and pageEntityIds
- `src/ai/flows/friends-flow.ts` - Filter selectedIds in 3 functions

---

#### `610171a` - Add "Fun with my friends" story generator

**Type**: Feature

**Summary**: New multi-phase story generator that creates adventure stories featuring the child's characters and friends. The flow guides children through 4 phases: (1) character selection with AI-proposed companions, (2) scenario selection from adventure options, (3) synopsis selection with "more" option, and (4) full story generation.

**Key Features**:
- Two-step character selection UX: Simple avatar display first ("Let's go!" to accept), "Give me other friends" to expand to full picker
- Siblings included as selectable characters alongside Family, Friend, Pet, Toy types
- "More synopses" replaces previous options instead of adding to them
- No minimum character requirement - solo adventures allowed
- Configurable AI prompts via admin Story Generators page

**Files Created**:
- `src/ai/flows/friends-flow.ts` - Multi-phase AI flow
- `src/app/api/storyFriends/route.ts` - API route
- `src/components/story/friends-proposal.tsx` - Simple avatar proposal UI
- `src/components/story/character-picker.tsx` - Full character grid picker

**Files Modified**:
- `src/lib/types.ts` - Added FriendsPhase, FriendsScenario, FriendsSynopsis types, extended StorySession
- `src/app/api/admin/story-generators/seed/route.ts` - Added friends generator config
- `src/app/admin/storyGenerators/page.tsx` - Added friends prompts, enabledForKids toggle
- `src/components/story/story-browser.tsx` - Integrated friends flow with BrowserState handling
- `src/app/admin/kids-flows/page.tsx` - Added friendsEnabled toggle
- `src/app/api/admin/system-config/kids-flows/route.ts` - Handle friendsEnabled field
- `docs/SCHEMA.md` - Documented new types and session fields
- `docs/API.md` - Documented /api/storyFriends endpoint

---

#### `48b38c6` - Fix Firestore "documentPath must be non-empty" error

**Type**: Bug Fix

**Summary**: Fixed Firestore error caused by empty strings in actor ID arrays. When story.actors contained empty strings, calls to `.doc()` would fail with "Value for argument 'documentPath' is not a valid resource path".

**Changes**:
- Added filtering for empty/invalid actor IDs in storybook viewer page
- Added filtering for empty/invalid actor IDs in story-synopsis-flow

**Files Modified**:
- `src/app/storybook/[bookId]/page.tsx` - Filter empty actor IDs before Firestore calls
- `src/ai/flows/story-synopsis-flow.ts` - Filter empty actor IDs before Firestore calls

---

#### `2a377d2` - Add audio generation controls to storybook viewer

**Type**: Feature

**Summary**: Parents can now see audio status and generate narration for storybook pages directly from the storybook viewer. Also fixed immersive player to pause 10 seconds on pages without audio instead of stopping.

**Changes**:
- Added audio status badge showing audio ready/total count
- Added "Generate Narration" button (appears after images are ready)
- Immersive player now pauses 10 seconds on pages without audio, then continues
- Fixed pre-existing type error in friends-flow.ts

**Files Modified**:
- `src/app/storybook/[bookId]/page.tsx` - Audio status and generate button
- `src/components/book-reader/immersive-player.tsx` - 10s pause on no-audio pages
- `src/ai/flows/friends-flow.ts` - Fixed EntityMap type error

---

#### `311326c` - Skip pages without images in ImmersivePlayer

**Type**: Enhancement

**Summary**: The ImmersivePlayer now filters out pages that don't have images (like title pages and blank pages). Only pages with actual images are shown in the immersive reading experience.

**Files Modified**:
- `src/components/book-reader/immersive-player.tsx` - Filter pages to only show those with images

---

#### `0f911e5` - Resolve placeholders server-side in share API

**Type**: Bug Fix

**Summary**: Shared storybooks were displaying unresolved placeholder IDs (like `$$abc123$$`) instead of character/child names. Added server-side placeholder resolution in the share API GET handler to ensure all text is resolved before returning to the client.

**Files Modified**:
- `src/app/api/storyBook/share/route.ts` - Added placeholder resolution after fetching pages

---

#### `61d4fc0` - Fix ImmersivePlayer crash on public share pages

**Type**: Bug Fix

**Summary**: The ImmersivePlayer crashed with "useFirebase must be used within a FirebaseProvider" error on public share pages. Added `useFirebaseSafe()` hook that returns null instead of throwing when Firebase context is unavailable. Updated `useResolvePlaceholders` hooks to gracefully return original texts when Firebase isn't available.

**Files Modified**:
- `src/firebase/provider.tsx` - Added `useFirebaseSafe()` hook
- `src/hooks/use-resolve-placeholders.ts` - Updated to use safe hook and handle missing context

---

#### `f44baa4` - Auto-focus PIN input in parent PIN dialog

**Type**: Bug Fix

**Summary**: The PIN input field in the parent PIN dialog now auto-focuses when the dialog opens. The `autoFocus` attribute doesn't work reliably in dialogs due to animation timing, so added a `useEffect` with a short delay to focus the input after mount.

**Files Modified**:
- `src/components/parent/pin-form.tsx`

---

#### `ad759b3` - Fix share page not reading URL params

**Type**: Bug Fix

**Summary**: The share page was sending `shareId=undefined` to the API because it was using the old Next.js params pattern. Client components need to use `useParams()` and `useSearchParams()` hooks instead of receiving params as props.

**Files Modified**:
- `src/app/storybook/share/[shareId]/page.tsx`

---

#### `820613c` - Update Git workflow to single-push pattern

**Type**: Process

**Summary**: Updated CLAUDE.md with improved Git workflow that uses `git commit --amend` to include the commit ID in CHANGES.md before pushing, avoiding two Firebase builds per change.

**Files Modified**:
- `CLAUDE.md`

---

#### `fae8415` - Fix share link errors and public page layout

**Type**: Bug Fix

**Summary**: Fixed two issues with public storybook share links:
1. FAILED_PRECONDITION error - The collectionGroup query on shareTokens required a Firestore index. Replaced with a `shareLinks` lookup collection that maps shareId → storyId.
2. Header showing authenticated UI - The share page was showing "Switch to Parent" in the header. Added route detection in Providers to hide the header/chrome on public routes.

**Changes**:
- Created `shareLinks` collection for share link lookups (avoids collectionGroup index)
- Updated share API POST to write to both shareTokens and shareLinks
- Updated share API GET to use shareLinks lookup instead of collectionGroup query
- Added PUBLIC_ROUTES detection in Providers to hide header on public pages
- Updated Firestore security rules to v19 with shareLinks collection

**Files Modified**:
- `src/app/api/storyBook/share/route.ts`
- `src/app/providers.tsx`
- `firestore.rules`
- `docs/SCHEMA.md`

---

### 2026-01-03

#### `3a06d54` - Enhanced storybook sharing with immersive viewer

**Type**: Feature

**Summary**: Parents can now share finalized storybooks with friends and family via a secure share link. Shared storybooks display in the same immersive full-screen reader that children use, with optional passcode protection and expiration dates.

**Changes**:
- Updated `/api/storyBook/share` POST to support new storybook model (storybookId parameter)
- Updated `/api/storyBook/share` GET to read pages from storybook subcollection
- Replaced basic card grid in `/storybook/share/[shareId]` with ImmersivePlayer component
- Added welcome screen with cover image and "Tap to read" button
- Added Share card to storybook viewer page with create/revoke controls
- Added passcode toggle and custom passcode input
- Share tokens now store storyId and storybookId for proper data location

**Files Modified**:
- `src/app/api/storyBook/share/route.ts`
- `src/app/storybook/share/[shareId]/page.tsx`
- `src/app/storybook/[bookId]/page.tsx`
- `docs/API.md`
- `docs/SCHEMA.md`

---

#### `a52d764` - Add global image prompt configuration

**Type**: Feature

**Summary**: Added configurable global image prompt that is prepended to all image generation requests. Allows setting consistent guidelines for image style, safety, and appropriateness across all storybook illustrations.

**Changes**:
- Added `ImagePromptConfig` type to types.ts
- Created `image-prompt-config.server.ts` with caching
- Created `/api/admin/system-config/image-prompt` API route
- Created `/admin/image-prompt` admin page
- Updated `story-image-flow.ts` to use global image prompt
- Added link to admin page under AI Prompts section

**Files Created**:
- `src/lib/image-prompt-config.server.ts`
- `src/app/api/admin/system-config/image-prompt/route.ts`
- `src/app/admin/image-prompt/page.tsx`

**Files Modified**:
- `src/lib/types.ts`
- `src/ai/flows/story-image-flow.ts`
- `src/app/admin/page.tsx`
- `docs/SCHEMA.md`
- `docs/API.md`

---

#### `ffea343` - Add Report Issue button for all users

**Type**: Feature

**Summary**: When enabled via the "Report Issue Button" toggle in Admin > Diagnostics, a warning icon button appears in the header for all authenticated users. Clicking it opens a dialog where users can describe an issue, which is then emailed to all users with maintenanceUser=true.

**Details**:
- ReportIssueButton component with dialog and loading states
- /api/report-issue endpoint using notifyMaintenanceError
- Toggle in admin diagnostics settings (showReportIssueButton)
- Automatically includes page path, user info, and browser diagnostics
- Available to ALL users (parents, writers, admins) when enabled

**Files Created**:
- `src/app/api/report-issue/route.ts`
- `src/components/report-issue-button.tsx`

**Files Modified**:
- `src/app/admin/page.tsx`
- `src/components/header.tsx`
- `src/hooks/use-diagnostics.tsx`
- `docs/SCHEMA.md`
- `docs/API.md`

---

#### `3dd9532` - Add maintenance error email notifications

**Type**: Feature

**Summary**: Production-ready error notification system. When AI flows fail, maintenance users receive detailed email notifications with error context and diagnostics.

**Details**:
- Added `maintenanceUser` flag to UserProfile (users/{uid})
- Added `maintenanceError` email template type with {{flowName}} and {{errorType}} placeholders
- Created `maintenanceErrorTemplate()` builder with error details, page path, and diagnostics JSON
- Created `notifyMaintenanceError()` and `getMaintenanceEmails()` functions
- Added "Maint On/Off" toggle to Admin → Users page
- Added maintenanceError template to Admin → Email Config page
- storyImageFlow now sends notification emails on failures with extended diagnostics:
  - Story context (title, childId, parentUid, sessionId)
  - Page context (kind, pageNumber, entityIds, imagePrompt preview)
  - Configuration (model, dimensions, aspect ratio, style)
  - Full logs for debugging

**Modified files**:
- `src/lib/types.ts` - Added maintenanceUser to UserProfile, maintenanceError to EmailTemplateType
- `src/lib/email/templates.ts` - Added MaintenanceErrorDetails type and maintenanceErrorTemplate()
- `src/lib/email/notify-admins.ts` - Added notifyMaintenanceError() function
- `src/lib/email/get-notified-users.ts` - Added getMaintenanceUsers() and getMaintenanceEmails()
- `src/app/admin/users/page.tsx` - Added maintenance user toggle button
- `src/app/admin/email-config/page.tsx` - Added maintenanceError template configuration
- `src/ai/flows/story-image-flow.ts` - Integrated maintenance error notifications
- `docs/SCHEMA.md` - Documented maintenanceUser field and maintenanceError template

---

#### `a6eea18` - Add retry tracking to AI flow logs and hide generation logs

**Type**: Enhancement

**Summary**: AI flow logs now include retry tracking information (attempt number, max attempts, retry reason). Generation logs on storybook viewer are now hidden unless diagnostics panel is enabled.

**Details**:
- Added `attemptNumber`, `maxAttempts`, `retryReason` parameters to `logAIFlow`
- story-image-flow logs which attempt is being made and why it's retrying
- "Last generation logs" on `/storybook/[bookId]` only visible when diagnostics enabled
- Uses `useDiagnosticsOptional` hook to check `showDiagnosticsPanel` setting

**Modified files**:
- `src/lib/ai-flow-logger.ts`
- `src/ai/flows/story-image-flow.ts`
- `src/app/storybook/[bookId]/page.tsx`

---

#### `6660e57` - Fix retry order: remove style examples first, keep reference photos

**Type**: Bug Fix

**Summary**: The retry logic was removing reference photos first, but style example images (e.g., Dr. Seuss samples) are more likely to trigger copyright filters.

**Details**:
- Attempt 1: Full prompt with style examples, reference photos, and actor details
- Attempt 2: Remove style example images only (likely copyright trigger), keep reference photos and actor details
- Attempt 3: Minimal prompt - just art style text and scene, no images at all
- This preserves character consistency (reference photos) while removing the copyrighted style examples

**Modified files**:
- `src/ai/flows/story-image-flow.ts`

---

#### `ecf4c46` - Retry with simpler prompts when Gemini returns no image

**Type**: Enhancement

**Summary**: When Gemini returns a successful response but no image (content filtering), automatically retry with progressively simpler prompts.

**Details**:
- Attempt 1: Full prompt with reference photos, style examples, and actor details
- Attempt 2: Simplified prompt - just art style and scene, no reference photos
- Attempt 3: Minimal prompt - bare art style and scene only
- This gives content-filtered scenes 3 chances with different complexity levels
- Better final error messages indicating all 3 attempts failed

**Modified files**:
- `src/ai/flows/story-image-flow.ts`

---

#### `bc110b4` - Improve error messages when Gemini returns no image

**Type**: Enhancement

**Summary**: Better error messages when image generation completes but produces no image (usually due to content filtering).

**Details**:
- When Gemini's finish reason indicates safety blocking, show a clear message
- Log the finishReason and finishMessage for debugging
- Suggests actionable fixes: simplify scene, modify art style, etc.
- Handles cases where model returns text explanation instead of image

**Modified files**:
- `src/ai/flows/story-image-flow.ts`

---

#### `b9433d3` - Improve error display in storybook viewer page

**Type**: Enhancement

**Summary**: Show detailed error messages when image generation fails, and always display logs even on partial success.

**Details**:
- When viewing a failed page, the `imageMetadata.lastErrorMessage` is now displayed in an alert
- The `triggerImageJob` function now always captures logs (even when some images fail)
- Error messages now include partial success info (e.g., "20/24 images completed")
- Helps diagnose why specific pages fail (e.g., content filtering, rate limits)
- Added client-side placeholder resolution for page text (fixes unresolved `$$childId$$` showing)

**Modified files**:
- `src/app/storybook/[bookId]/page.tsx`

---

#### `1249e92` - Add retry button for failed image generation and fix TTS pronunciation

**Type**: Bug Fix / Enhancement

**Summary**: Added "Try Again" button on book generating page when image generation fails, and fixed TTS narration to use pronunciation hints for character names.

**Details**:
- **Retry Button**: When image generation fails (e.g., "One or more pages failed to render"), a "Try Again" button now appears. This calls the existing `/api/storybookV2/images` endpoint which only regenerates pages without `imageStatus === 'ready'`.
- **TTS Pronunciation Fix**: The `storyPageAudioFlow` was using `displayText` (already resolved without pronunciation) instead of `bodyText` with pronunciation hints. Now always resolves `bodyText` with `replacePlaceholdersForTTS()` which uses `namePronunciation` field for correct pronunciation of names like "Siobhan" → "shiv-AWN".
- **Client-side Placeholder Resolution**: Added fallback placeholder resolution in `ImmersivePlayer` using `useResolvePlaceholdersMultiple` hook for pages that may not have `displayText` pre-resolved.

**Modified files**:
- `src/app/child/[childId]/book/[storybookId]/generating/page.tsx` - Added retry button and handler
- `src/ai/flows/story-page-audio-flow.ts` - Fixed TTS to always use pronunciation hints
- `src/components/book-reader/immersive-player.tsx` - Added client-side placeholder resolution fallback

---

#### `086400b` - Add editable name and description fields to story generators admin page

**Type**: Enhancement

**Summary**: Story generator names and descriptions can now be edited in the admin UI and are reflected throughout the app.

**Details**:
- Added "General" tab with editable name and description fields
- Changes to generator names are stored in Firestore and displayed throughout the app
- Falls back to hardcoded defaults if name/description not set in database
- Also allows editing for the "beat" generator (was previously read-only)

**Modified files**:
- `src/app/admin/storyGenerators/page.tsx`

---

#### `612e996` - Fix single-dollar placeholder regex to allow hyphens and underscores

**Type**: Bug Fix

**Summary**: Single-dollar placeholder pattern was not matching IDs containing hyphens like `$my-first-child-147343$`.

**Details**:
- The regex `[a-zA-Z0-9]{15,}` only matched alphanumeric characters
- Firestore document IDs can contain hyphens and underscores
- Changed all patterns to `[a-zA-Z0-9_-]{15,}` to match IDs like `my-first-child-147343`

**Modified files**:
- All 9 files containing single-dollar placeholder regex patterns

---

#### `23c4792` - Fix background music restart and add single-dollar placeholder fallback

**Type**: Bug Fix / Enhancement

**Summary**: Fixed background music restarting from the beginning when narration starts, and extended single-dollar placeholder fallback to all placeholder extraction functions.

**Details**:

Background music fix:
- Music was restarting because the effect would call `play()` again when `isSpeaking` became true
- Changed logic to start music once when story creation begins and keep playing continuously
- Music now loops automatically (audio.loop = true in the hook)
- Only stops when story is complete or user manually disables it
- Added `musicStartedRef` to track whether music has already been started for the session

Placeholder resolution extension:
- The earlier fix only updated resolution functions, but extraction functions still only handled `$$id$$`
- Updated all `extractActorIds` and `extractEntityIds` functions to also match `$id$` format
- Uses 15+ char alphanumeric pattern to avoid matching currency amounts like $100

**Modified files**:
- `src/components/story/story-browser.tsx` - Music control logic and extractActorIdsFromText
- `src/ai/flows/story-compile-flow.ts` - extractActorIds function
- `src/ai/flows/story-page-flow.ts` - extractEntityIds function
- `src/ai/flows/story-synopsis-flow.ts` - extractActorIds function
- `src/ai/flows/story-text-compile-flow.ts` - extractActorIds function
- `src/lib/resolve-placeholders.server.ts` - replacePlaceholdersWithDescriptions function

---

#### `f7d4d2a` - Fix placeholder resolution for single $ format

**Type**: Bug Fix

**Summary**: Placeholder resolution was failing because the AI model sometimes outputs placeholders with single dollar signs (`$id$`) instead of the correct double dollar sign format (`$$id$$`).

**Details**:
- The regex `/\$\$([^$]+)\$\$/g` only matched double dollar sign format
- AI models (particularly Gemini) occasionally output single dollar format despite instructions
- Added fallback regex `/\$([a-zA-Z0-9]{15,})\$/g` to also match single $ format
- Minimum 15 chars requirement prevents false positives on currency amounts like $100

**Modified files**:
- `src/lib/resolve-placeholders.server.ts` - All server-side resolution functions
- `src/lib/resolve-placeholders.ts` - Client-side resolution functions
- `src/hooks/use-resolve-placeholders.ts` - React hook for placeholder resolution
- `src/lib/story-context-builder.ts` - extractActorIdsFromText function

---

#### `9d13242` - Fix background tasks not completing on story compilation

**Type**: Bug Fix

**Summary**: Background tasks (title generation, actor avatar, audio narration) were not completing on serverless platforms because they were fire-and-forget and could be terminated when the HTTP response was sent.

**Details**:
- Root cause: Background flows (storyTitleFlow, storyActorAvatarFlow, storyAudioFlow) were triggered without awaiting, and serverless functions terminate after response is sent
- Solution: Use Next.js `after()` API to ensure background tasks complete even after response
- Tasks now run in parallel using `Promise.allSettled` with proper result logging
- This fixes synopsis, title, and cast avatar not being generated after story completion

**Modified files**:
- `src/app/api/storyCompile/route.ts` - Added after() for background tasks

---

#### `31f432c` - Fix Firestore undefined value error in seed generators

**Type**: Bug Fix

**Summary**: Fixed "Cannot use undefined as a Firestore value" error when clicking "Seed Generators" button on admin page.

**Changes**:
- Changed from direct property assignment to conditional spreads
- Only includes backgroundMusic, prompts, createdAt if they exist on the document

**Files Modified**:
- `src/app/api/admin/story-generators/seed/route.ts`

---

#### `404f5d0` - Fix first page TTS autoplay blocked and avatar fallback delay

**Type**: Bug Fix

**Summary**: Fixed two issues: TTS audio not playing on first page due to browser autoplay restrictions, and character introduction card showing blank/random avatar while loading.

**Details**:
- TTS autoplay blocking: Browser blocks audio.play() without user gesture on first page load
  - Added `hasQueuedAudio` and `resumeQueuedAudio` to useTTS hook to queue blocked audio
  - Added "Tap to hear the story" button when autoplay is blocked
  - User can tap to start TTS, subsequent pages play automatically
- Avatar fallback delay: Radix AvatarFallback has 600ms default delay before showing
  - Changed default `delayMs` from 600 to 0 to show fallback immediately
  - Prevents blank/random image flash while avatar loads

**Modified files**:
- `src/hooks/use-tts.ts` - Added audio queuing for autoplay blocking
- `src/hooks/use-story-tts.ts` - Exposed new queued audio properties
- `src/components/story/story-browser.tsx` - Added "Tap to hear" button
- `src/components/ui/avatar.tsx` - Set fallback delayMs default to 0

---

#### `a490b42` - Fix seed route to properly update nested capabilities

**Type**: Bug Fix

**Summary**: Story generator seed route was not properly updating nested `capabilities` object due to shallow merge behavior.

**Details**:
- Changed from `batch.update()` to `batch.set()` with `merge: false`
- Preserves user-configured fields (backgroundMusic, prompts, createdAt)
- Fixes gemini4 still showing story type selection despite `requiresStoryType: false`

**Modified files**:
- `src/app/api/admin/story-generators/seed/route.ts`

---

#### `bcc66fb` - Add story generators admin page with music and prompts

**Type**: Feature

**Summary**: Added admin UI for configuring story generators (wizard, gemini3, gemini4) with background music generation and custom AI prompt editing.

**Details**:
- Extended `StoryGenerator` type with `backgroundMusic` and `prompts` fields
- Created `/api/music/generate-generator` API for generator music generation
- Updated wizard, gemini3, and gemini4 flows to read prompts from Firestore with fallback to hardcoded defaults
- Created `/admin/storyGenerators` page for managing generators
- Admin can generate background music for each generator (same as story types)
- Admin can view and edit all AI prompts with changes taking effect immediately

**Modified files**:
- `src/lib/types.ts` - Extended StoryGenerator type
- `src/app/api/music/generate-generator/route.ts` - New API
- `src/ai/flows/story-wizard-flow.ts` - Added Firestore prompt loading
- `src/ai/flows/gemini3-flow.ts` - Added Firestore prompt loading
- `src/ai/flows/gemini4-flow.ts` - Added Firestore prompt loading
- `src/app/admin/storyGenerators/page.tsx` - New admin page
- `docs/SCHEMA.md` - Updated with new fields

---

#### `5d01911` - Fix documentPath error in image generation

**Type**: Bug Fix

**Summary**: Image generation was failing with "documentPath is not a valid resource path" error when entity IDs contained empty strings from the AI pagination response.

**Details**:
- The AI pagination flow sometimes returns empty strings in the `actors` array
- When passed to Firestore `where('__name__', 'in', [...])` query, empty strings cause an error
- Added filtering in `fetchEntityReferenceData` and `fetchEntityAvatarsOnly` to remove empty/whitespace-only IDs
- Added early return if all IDs are filtered out

**Files Modified**:
- `src/ai/flows/story-image-flow.ts`

---

#### `5c6f4de` - Fix story completion flow with explicit Continue button

**Type**: Enhancement

**Summary**: Story completion now keeps the final story visible and requires the user to click "Continue to My Stories" to proceed, ensuring they can read their story before being redirected.

**Details**:
- Removed 5-second auto-compile timeout that was auto-advancing users
- Added "Continue to My Stories" button on the completion screen
- Button triggers story compilation which kicks off background tasks:
  - Audio narration generation (storyAudioFlow)
  - Cast avatar generation (storyActorAvatarFlow)
  - Title generation (storyTitleFlow)
- Standardized across all four story generators (wizard, gemini3, gemini4, beat)
- All generators use the same StoryBrowser component for consistent behavior

**Files Modified**:
- `src/components/story/story-browser.tsx`

---

#### `c0d3d9c` - Add full-width story controls bar below header

**Type**: Enhancement

**Summary**: Replaced floating controls with a proper full-width control bar that sits below the main header, resolving layout overlap issues.

**Details**:
- Story Controls Bar: sticky at `top-14` (below 56px header), full width
- Left side: Shows generator name (e.g., "Story Wizard")
- Right side: Music toggle, Read to Me toggle, Settings link
- Labels shown on larger screens (`sm:inline`), icons only on mobile
- Matches header styling with backdrop blur and border
- Updated `SpeechModeToggle` to support `showLabel` prop

**Files Modified**:
- `src/components/story/story-browser.tsx`
- `src/components/child/speech-mode-toggle.tsx`

---

#### `2bcf1b9` - Fix gemini4 generator to skip story type selection

**Type**: Bug Fix

**Summary**: The Guided Story (gemini4) flow was showing story type selection but didn't actually use it. Changed `requiresStoryType` to `false`.

**Details**:
- The gemini4 flow uses its own internal phase system (opening, setting, characters, conflict, resolution)
- It doesn't use story types from the storyTypes collection
- Now skips story type selection and goes directly to the story
- **Action Required**: Re-run the seed API at `/api/admin/story-generators/seed` or manually update `storyGenerators/gemini4` in Firestore

**Files Modified**:
- `src/app/api/admin/story-generators/seed/route.ts`

---

#### `455558b` - Fix wizard flow and TTS autoplay issues

**Type**: Bug Fix

**Summary**: Fixed two issues: wizard flow calling wrong API after first selection, and TTS showing error toast for browser autoplay restrictions.

**Changes**:

1. **Fix wizard 500 error after first selection**
   - Story browser was incorrectly calling `/api/storyEnding` for wizard generator
   - When no arc steps exist (wizard doesn't use story types), it treated this as "reached end"
   - Now only applies arc step management for generators with `requiresStoryType: true`
   - Wizard handles its own completion via `isStoryComplete` flag in API response

2. **Handle browser TTS autoplay restrictions**
   - Browsers block `audio.play()` when not triggered by user gesture
   - Added `NotAllowedError` handling to suppress the error toast
   - User can tap any element to enable audio playback after

**Files Modified**:
- `src/components/story/story-browser.tsx`
- `src/hooks/use-tts.ts`

---

#### `7524fd9` - Fix home icon to navigate to child dashboard

**Type**: Bug Fix

**Summary**: When logged in as a child, clicking the header logo now navigates to `/child/{childId}` instead of the root path.

**Files Modified**:
- `src/components/header.tsx`

---

#### `02b7c8e` - Fix create-book flow and add diagnostics

**Type**: Bug Fix

**Summary**: Fixed three issues in the storybook creation flow: output type selection being skipped, Firestore "documentPath" errors, and missing diagnostics panel.

**Changes**:

1. **Create-book no longer skips output type selection**
   - Previously, if story had `metadata.storyOutputTypeId`, it would skip directly to art style selection
   - Now always shows output type selection, with pre-selection if available

2. **Fix "documentPath" error in page generation**
   - Empty or invalid actor IDs in `story.actors` could cause Firestore doc() calls to fail
   - Added filtering to remove empty/invalid IDs before querying

3. **Add DiagnosticsPanel to book generating page**
   - Shows storybook generation state, page/image generation status, progress info

**Files Modified**:
- `src/app/child/[childId]/create-book/[storyId]/page.tsx`
- `src/ai/flows/story-page-flow.ts`
- `src/app/child/[childId]/book/[storybookId]/generating/page.tsx`

---

#### `41d269e` - Add separate music and narration toggles to story browser

**Type**: Enhancement

**Summary**: Story browser header now has separate toggles for background music and TTS narration, allowing users to control each independently.

**Changes**:

- Added `musicEnabled` state for user music preference
- Music toggle button with Music/VolumeX icons
- Narration toggle using existing SpeechModeToggle component
- Fixed header layout with contained box styling (rounded, backdrop blur)
- Consistent button sizing (h-8 w-8) to prevent overlap
- Replaced MusicOff with VolumeX (MusicOff doesn't exist in lucide-react)

**Files Modified**:
- `src/components/story/story-browser.tsx`

---

#### `49db01e` - Enable "Read to Me" by default for new children

**Type**: Enhancement

**Summary**: New child profiles now have TTS narration enabled by default, so parents don't need to manually configure voice settings.

**Changes**:

- Set `preferredVoiceId` to `DEFAULT_TTS_VOICE` (Alice - British) on new children
- Set `autoReadAloud` to `true` on new children
- Updated both EntityEditor and admin create page

**Files Modified**:
- `src/components/shared/EntityEditor.tsx`
- `src/app/admin/create/page.tsx`

---

### 2026-01-02

#### `bc4cd31` - Fix wizard flow placeholder resolution and story compilation

**Type**: Bug Fix

**Summary**: Fixed three issues with the wizard story flow: unresolved placeholders in final story, immediate redirect after completion, and missing cast avatar generation.

**Changes**:

1. **Placeholder Resolution in Wizard Flow**:
   - The entity map only included characters, not the main child
   - Added childId, mainChild, and siblings to the entity map using EntityMap type
   - Now `$$childId$$` placeholders resolve correctly to the child's name

2. **Final Story Display Duration**:
   - Story was immediately redirecting after completion (no time to read)
   - Added 5-second delay to show final story before auto-compile
   - Set browserState to 'complete' to display the story first

3. **Wizard Mode Story Compilation**:
   - storyCompileFlow didn't handle wizard mode (requiresStoryType: false)
   - Added dedicated wizard mode handler that:
     - Loads existing story created by wizard flow
     - Extracts actors from session (childId always included)
     - Generates synopsis if not present
     - Sets up actors, generation statuses (actorAvatarGeneration: pending)
     - Returns storyId to trigger background tasks (avatar, title, audio)

**Files Modified**:
- `src/ai/flows/story-wizard-flow.ts` - Include child/siblings in entity map
- `src/ai/flows/story-compile-flow.ts` - Add wizard mode handling
- `src/components/story/story-browser.tsx` - Add delay before redirect

---

#### `08e8eab` - Fix placeholder resolution in wizard API response

**Type**: Bug Fix

**Summary**: The Story Wizard API was returning questions and choices with unresolved `$$childId$$` placeholders, causing raw placeholder text to display instead of the child's name.

**Changes**:

1. **Placeholder Resolution**:
   - Import `resolveEntitiesInText` and `replacePlaceholdersInText` from server utilities
   - Extract all entity IDs from question and choice texts
   - Resolve placeholders before returning response
   - Set `questionResolved` and `textResolved` fields with resolved text

**Files Modified**:
- `src/app/api/storyWizard/route.ts`

---

#### `c367dc0` - Add ending flow integration to StoryBrowser

**Type**: Feature

**Summary**: StoryBrowser now properly handles story completion by calling the ending API when the arc completes, displaying ending choices, and auto-compiling when the user selects an ending.

**Changes**:

1. **Ending Flow Integration**:
   - Added `callEndingAPI()` function to call `/api/storyEnding`
   - When arc reaches last step, calls ending API instead of beat API
   - Stores ending options in Firestore messages collection
   - Displays ending choices with `isEndingPhase: true`

2. **Ending Selection**:
   - When user selects an ending option, saves `selectedEndingId` and `selectedEndingText` to session
   - Triggers auto-compile after ending selection
   - Redirects to completion path after compile

3. **Additional Diagnostics**:
   - Added `generatorError` to diagnostics panel
   - Added `firestoreReady` flag to verify Firestore connection

**Files Modified**:
- `src/components/story/story-browser.tsx`

---

#### `6cb2ceb` - Add storyGenerators to Firestore rules (v18)

**Type**: Bugfix

**Summary**: The `storyGenerators` collection was missing from security rules, causing "Generator not found" errors.

**Files Modified**:
- `firestore.rules`

---

#### `31a19ee` - Fix StoryBrowser arc progression and add diagnostics

**Type**: Bugfix

**Summary**: Fixed critical bug where StoryBrowser wasn't incrementing the arcStepIndex when options were selected, preventing story progression. Added comprehensive diagnostics to debug flow state.

**Changes**:

1. **Arc Step Progression**:
   - Added arcStepIndex increment when child selects an option
   - Fetches arc template from story type to calculate next step
   - Detects when arc ends and transitions to ending phase
   - Only increments during normal story phase (not ending phase)

2. **Enhanced Diagnostics Panel**:
   - Added `errorMessage` display for error state visibility
   - Added generator info (name, endpoint, requiresStoryType, etc.)
   - Added session info (storyTypeId, arcStepIndex, currentPhase)
   - Added story type info (id, name, arcStepsCount)
   - Renamed `limit` import to `firestoreLimit` to avoid conflicts

**Files Modified**:
- `src/components/story/story-browser.tsx`

---

#### `1986cab` - Unify story play pages with StoryBrowser

**Type**: Refactor

**Summary**: All story generator APIs now return a standard `StoryGeneratorResponse` format, and both the parent-facing `/story/play` and new kids PWA `/kids/play` routes use the unified `StoryBrowser` component.

**Changes**:

1. **Normalized API Routes**:
   - `/api/storyBeat` - Now returns `StoryGeneratorResponse` with `headerText` for story continuation
   - `/api/gemini3` - Now returns `StoryGeneratorResponse` with merged option text
   - `/api/gemini4` - Now returns `StoryGeneratorResponse` with `isMoreOption` support

2. **Extended Types** (`src/lib/types.ts`):
   - Added `headerText`, `headerTextResolved` to `StoryGeneratorResponse` for beat mode
   - Added `isMoreOption` to `StoryGeneratorResponseOption` for gemini4 "Tell me more"

3. **Enhanced StoryBrowser** (`src/components/story/story-browser.tsx`):
   - Added `headerText` display for story continuation (beat mode)
   - Added ending phase handling
   - Added auto-compile on story completion
   - Added message storage in Firestore
   - Added actor ID extraction and tracking
   - Added completion redirect support

4. **Simplified Play Page** (`src/app/story/play/[sessionId]/page.tsx`):
   - Reduced from ~1200 lines to ~95 lines
   - Now uses `<StoryBrowser />` for all story modes (beat, gemini3, gemini4)

5. **New Kids PWA Play Page** (`src/app/kids/play/[sessionId]/page.tsx`):
   - New route for interactive story creation in kids PWA
   - Uses StoryBrowser with kids-specific settings (no settings link)
   - Enforces child session ownership

**Files Modified**:
- `src/lib/types.ts` - Extended StoryGeneratorResponse types
- `src/app/api/storyBeat/route.ts` - Normalized to StoryGeneratorResponse
- `src/app/api/gemini3/route.ts` - Normalized to StoryGeneratorResponse
- `src/app/api/gemini4/route.ts` - Normalized to StoryGeneratorResponse
- `src/components/story/story-browser.tsx` - Enhanced for all modes
- `src/app/story/play/[sessionId]/page.tsx` - Simplified to use StoryBrowser

**Files Created**:
- `src/app/kids/play/[sessionId]/page.tsx` - New kids PWA play page

---

#### `3c5632e` - Migrate wizard page to StoryBrowser

**Type**: Refactor

**Summary**: First migration to the unified StoryBrowser architecture. The wizard page now uses the StoryBrowser component instead of its own custom UI.

**Changes**:

1. **New API Route** (`src/app/api/storyWizard/route.ts`):
   - Wraps `storyWizardFlow` with standard `StoryGeneratorResponse` format
   - Stores wizard Q&A state in session (`wizardAnswers`, `wizardLastQuestion`, `wizardLastChoices`)
   - Enables StoryBrowser to drive the wizard flow

2. **Updated Types** (`src/lib/types.ts`):
   - Added `wizardAnswers?: StoryWizardAnswer[]` to `StorySession`

3. **Refactored Wizard Page** (`src/app/story/wizard/[sessionId]/page.tsx`):
   - Now uses `<StoryBrowser generatorId="wizard" />` instead of custom UI
   - Reduced from ~200 lines to ~100 lines
   - Gains: TTS, A/B/C labels, speech toggle header, consistent styling

**Files Modified**:
- `src/lib/types.ts` - Added wizardAnswers to StorySession
- `src/app/api/storyWizard/route.ts` - New API route
- `src/app/story/wizard/[sessionId]/page.tsx` - Migrated to StoryBrowser
- `docs/SCHEMA.md` - Added wizard fields to storySessions
- `docs/API.md` - Added storyWizard endpoint

---

#### `53da81c` - Add Story Browser architecture foundation

**Type**: Feature (Foundation)

**Summary**: Added the foundation for a unified "Story Browser" component that will provide consistent UI across all story generation modes (wizard, gemini3, gemini4, beat).

**Concept**: The StoryBrowser treats story generators as pluggable backends that advertise their capabilities. The browser adapts its UI based on what each generator supports (e.g., "More options" button only shown if generator supports it).

**Changes**:

1. **New Types** (`src/lib/types.ts`):
   - `StoryGenerator` - Generator configuration with capabilities and styling
   - `StoryGeneratorCapabilities` - What features a generator supports
   - `StoryGeneratorStyling` - UI customization (gradient, icon, loading message)
   - `StoryGeneratorResponse` - Standard API response format for all generators

2. **New Collection** (`storyGenerators`):
   - Firestore collection for generator configurations
   - Documents define capabilities, API endpoint, and styling
   - Enables adding new generators without code changes

3. **New Component** (`src/components/story/story-browser.tsx`):
   - Self-contained component for all story interaction
   - Handles: TTS, placeholder resolution, A/B/C labels, background music
   - Internal state machine: loading → story_type → generating → question → character_intro → complete
   - Adapts UI based on generator capabilities

4. **Seed API** (`/api/admin/story-generators/seed`):
   - Seeds default generator configurations (wizard, gemini3, gemini4, beat)
   - Admin-only endpoint

**Next Steps** (in subsequent commits):
- Migrate `/story/wizard/[sessionId]` to use StoryBrowser
- Migrate `/story/play/[sessionId]` to use StoryBrowser
- Create `/kids/play/[sessionId]` using StoryBrowser

**Files Created**:
- `src/components/story/story-browser.tsx`
- `src/app/api/admin/story-generators/seed/route.ts`

**Files Modified**:
- `src/lib/types.ts` - Added StoryGenerator types
- `src/components/story/index.ts` - Export StoryBrowser
- `docs/SCHEMA.md` - Document storyGenerators collection

---

#### `a78b05a` - Fix multiple story generation flow issues

**Type**: Bug Fix

**Summary**: Fixed three issues preventing Gemini3 and Guided Story modes from working correctly.

**Issues Fixed**:

1. **Story type picker shown incorrectly for Gemini3/Gemini4 modes**
   - Gemini3 and Gemini4 modes have their own flows and don't need story types
   - But the play page was showing "Pick your kind of story" which then routed to storyBeatFlow
   - Fixed by excluding Gemini modes from the `showStoryTypePicker` condition

2. **Gemini3 "maximum nesting depth" schema error**
   - The Gemini3 output schema was too complex with nested objects, optional+nullable fields, and z.enum
   - Gemini API has limits on schema nesting depth
   - Simplified the schema by: separating the option schema, removing `.nullable()`, using `z.string()` instead of `z.enum` for characterType

3. **storyBeatFlow "user role" error**
   - Error: "Please ensure that single turn requests end with a user role"
   - When using the `messages` array with Genkit, Gemini API requires the last message to be from the user
   - Added check for last message role before using messages array; falls back to legacy system when last message is from model

**Files Modified**:
- `src/app/story/play/[sessionId]/page.tsx` - Added `isGeminiMode` check to `showStoryTypePicker`
- `src/ai/flows/gemini3-flow.ts` - Simplified `Gemini3OutputSchema` to avoid nesting depth limits
- `src/ai/flows/story-beat-flow.ts` - Added `lastMessageIsFromUser` check before using messages array

---

#### `dd0a7cb` - Fix story wizard "Cannot read properties of undefined" error

**Type**: Bug Fix

**Summary**: Fixed the story wizard failing with "Cannot read properties of undefined (reading 'content')" when starting a new wizard session with no previous answers.

**Root Cause**: When the story wizard was called with an empty `answers` array (the initial call), it passed an empty `messages` array to Genkit's `ai.generate()`. The Genkit library has issues processing empty message arrays with the `system` parameter, causing internal errors.

**Fix**: Added a conditional check - when there are no previous messages, use `prompt` parameter instead of `messages` with `system`. This matches the pattern used in `story-beat-flow.ts`.

**Files Modified**:
- `src/ai/flows/story-wizard-flow.ts` - Added conditional for empty messages array

---

#### `2dfbea3` - Add email configuration admin page

**Type**: Feature

**Summary**: Added a full email configuration system that allows admins to configure the sender email address and customize the content of all system emails from the admin dashboard.

**Features**:
- Configurable sender email address (stored in Firestore instead of hardcoded)
- Customizable email templates for all notification types:
  - Order submitted
  - Order status changed
  - Order approved
  - Order rejected
  - Order cancelled
  - Test email
- Per-template settings: subject, heading, body text, button text, button URL
- Enable/disable toggle for each email type
- Brand color picker for email buttons
- Customizable footer text
- 1-minute cache for email config to reduce Firestore reads
- New admin page at `/admin/email-config` with tabbed interface

**Files Created**:
- `src/app/admin/email-config/page.tsx` - Email configuration admin page

**Files Modified**:
- `src/lib/types.ts` - Added EmailConfig, EmailTemplate, EmailTemplateType types and DEFAULT_EMAIL_CONFIG
- `src/lib/email/send-email.ts` - Now reads sender from Firestore config with caching
- `src/lib/email/templates.ts` - Refactored to use configurable templates from Firestore
- `src/lib/email/notify-admins.ts` - Updated to handle async templates that may return null
- `src/app/api/admin/test-email/route.ts` - Now uses configurable test email template
- `src/app/admin/page.tsx` - Added link to email configuration page
- `docs/SCHEMA.md` - Added systemConfig/email documentation
- `docs/API.md` - Updated test-email route documentation

---

#### `065d663` - Add preferred flag to image styles

**Type**: Feature

**Summary**: Added a `preferred` boolean field to ImageStyle. When set to true, these styles appear first in child-facing image style selection, sorted alphabetically within the preferred group, followed by non-preferred styles also sorted alphabetically.

**Files Modified**:
- `src/lib/types.ts` - Added `preferred?: boolean` field to ImageStyle type
- `docs/SCHEMA.md` - Documented the new field
- `src/app/child/[childId]/create-book/[storyId]/page.tsx` - Sort preferred styles first
- `src/app/kids/create/[sessionId]/style/page.tsx` - Sort preferred styles first
- `src/app/admin/image-styles/page.tsx` - Added Preferred badge and toggle switch in editor

---

#### `258f1b6` - Remove help-child from parent's children list

**Type**: Bug fix

**Summary**: The demo "help-child" document was being fetched and displayed to parents on their /parent/children page. This was intended for wizard demonstrations but was incorrectly showing the demo child to all parents.

**Files Modified**:
- `src/app/parent/children/page.tsx` - Removed fetchHelpChild logic and getDoc import

---

#### `63fc311` - Schema cleanup: Remove deprecated fields

**Type**: Cleanup

**Summary**: Removed deprecated and redundant fields from the schema to simplify the data model. Pre-resolved text fields are no longer stored; consumers now resolve placeholders dynamically.

**Fields Removed**:
- **ChildProfile**: `speechModeEnabled` (use `autoReadAloud`), `estimatedLevel`, `favouriteGenres`, `favouriteCharacterTypes`, `preferredStoryLength`, `helpPreference`, `preferences` object
- **Character**: `role` (use `type`), `traits` (use `likes`), `sessionId`, `visualNotes`, `realPersonRef`
- **StorySession**: `storyTypeName` (lookup from storyTypeId), `finalStoryText` (use Story.storyText)
- **ChatMessage**: `textResolved`, `optionsResolved` (resolve dynamically with `useResolvePlaceholders` hook)

**Files Modified**:
- `src/lib/types.ts` - Removed deprecated type fields
- `src/lib/resolve-placeholders.ts` - Updated to use `type`/`likes` instead of `role`/`traits`
- `src/lib/child-preferences.ts` - Updated to use new field names
- `src/ai/flows/story-compile-flow.ts` - Stopped writing `finalStoryText`
- `src/ai/flows/story-image-flow.ts` - Updated character description building
- `src/ai/flows/story-page-flow.ts` - Updated character description building
- `src/ai/flows/character-traits-flow.ts` - Updated to use `type`/`likes`
- `src/ai/flows/start-story-flow.ts` - Removed legacy field initialization
- `src/ai/flows/story-chat-flow.ts` - Removed `finalStoryText` from schema
- `src/app/story/play/[sessionId]/page.tsx` - Stopped writing resolved text fields
- `src/app/story/wizard/[sessionId]/page.tsx` - Stopped writing `finalStoryText`
- `src/app/kids/create/page.tsx` - Stopped writing `finalStoryText`
- `src/app/admin/characters/page.tsx` - Removed legacy "Ask traits" button
- `src/data/help-sample-data.json` - Removed `finalStoryText`
- `docs/SCHEMA.md` - Updated documentation

**Migration Notes**:
- Existing stored data continues to work (fallback pattern: `msg.textResolved || msg.text`)
- Future enhancement: Update all reader components to use `useResolvePlaceholders` hook

---

#### `7f60d7b` - Add pronunciation test button to EntityEditor

**Type**: Feature

**Summary**: Parents can now test how the AI will pronounce a child's or character's name by clicking a speaker button next to the pronunciation field.

**Changes**:
- Added speaker button (Volume2 icon) next to the pronunciation input field
- Button uses the child's preferred TTS voice if set
- Tests pronunciation text if entered, otherwise falls back to display name
- Shows loading spinner while generating, stop button while playing
- Works for both children and character entities in EntityEditor

**Files Modified**:
- `src/components/shared/EntityEditor.tsx` - Added pronunciation test functionality

---

#### `ac0c581` - Add example images to ImageStyle for AI reference

**Type**: Feature

**Summary**: Added the ability to upload example images to ImageStyles that are passed to the AI image generation model as visual references. This improves consistency of generated images by giving the AI concrete examples of the desired art style.

**Changes**:
- Added `exampleImages` array field to ImageStyle type with id, url, storagePath, uploadedAt
- Created POST `/api/imageStyles/uploadExampleImage` - upload via file or URL
- Created POST `/api/imageStyles/deleteExampleImage` - remove example images
- Updated admin image-styles page with example images management UI
- Updated story-image-flow to load and pass example images to Gemini
- Example images appear before character photos in the prompt
- Prompt instructs AI to match style, color palette, and aesthetic
- Gracefully handles styles without example images (empty array)

**Files Modified**:
- `src/lib/types.ts` - Added ImageStyleExampleImage type
- `src/app/api/imageStyles/uploadExampleImage/route.ts` - New
- `src/app/api/imageStyles/deleteExampleImage/route.ts` - New
- `src/app/admin/image-styles/page.tsx` - Added example images UI
- `src/ai/flows/story-image-flow.ts` - Load and use example images
- `src/app/api/storybookV2/images/route.ts` - Pass imageStyleId to flow
- `docs/SCHEMA.md` - Updated imageStyles schema
- `docs/API.md` - Documented new endpoints

---

### 2026-01-01

#### `3a2131e` - Add blankPages and spine fields to PrintProduct

**Type**: Feature

**Summary**: Added page composition settings to PrintProduct for controlling PDF generation. The `blankPages` field specifies fixed blank pages (e.g., endpapers) and `spine` controls whether the cover PDF includes a spine page.

**Changes**:
- Added `blankPages` (number) and `spine` (boolean) fields to PrintProduct type
- Updated print products admin page with Page Composition section
- Updated PDF generation to use new interior page adjustment logic:
  1. Inside pages must meet minimum page count
  2. Total pages (2 cover + blankPages + inside) must be multiple of 4
  3. Truncate if inside exceeds maximum
- Cover PDF now respects `spine` setting (front + spine + back or just front + back)
- Added `calculateInteriorPageAdjustment()` function to print-constraints.ts

**Files Modified**:
- `src/lib/types.ts` - Added blankPages and spine to PrintProduct
- `src/app/admin/print-products/page.tsx` - Added UI fields for page composition
- `src/lib/print-constraints.ts` - Added calculateInteriorPageAdjustment function
- `src/app/api/storyBook/printable/route.ts` - Updated PDF generation logic
- `docs/SCHEMA.md` - Documented new fields

---

#### `f028774` - Fix createdAt showing N/A on print orders admin page

**Type**: Bug Fix

**Summary**: The Created date was showing "N/A" on `/admin/print-orders` because the Firebase Admin SDK Timestamp wasn't being converted correctly when serializing for JSON response.

**Changes**:
- Reordered timestamp conversion checks to prioritize `toDate()` method
- Admin SDK Timestamps have seconds/nanoseconds as getter properties (not enumerable), so the `toDate()` method is the reliable way to extract the value

**Files Modified**:
- `src/app/api/admin/print-orders/route.ts` - Fixed convertTimestamp function

---

#### `6086ba7` - Switch email from SMTP to Microsoft Graph API

**Type**: Feature / Infrastructure

**Summary**: Replaced SMTP-based email sending with Microsoft Graph API. Security Defaults in Microsoft 365 blocks SMTP basic auth, so switched to modern OAuth via Azure AD App Registration.

**Changes**:
- Replaced nodemailer with @azure/identity and @microsoft/microsoft-graph-client
- Updated send-email.ts to use Graph API sendMail endpoint
- Updated test-email route to check for Azure credentials
- Updated apphosting.yaml with AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET secrets
- Added "Send Test Email" button to Admin Dashboard Diagnostics section

**Files Created**:
- `src/app/api/admin/test-email/route.ts`

**Files Modified**:
- `src/lib/email/send-email.ts` - Switched from nodemailer to Microsoft Graph
- `src/app/admin/page.tsx` - Added test email button
- `apphosting.yaml` - Replaced SMTP secrets with Azure secrets
- `docs/API.md` - Added test-email endpoint documentation

**Setup Required**:
- Azure AD App Registration with Mail.Send application permission
- Secrets: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET

---

#### `37beb80` - Add print product page constraints to storybook pipeline

**Type**: Feature

**Summary**: Added page constraints (min/max pages, page multiple) to the storybook generation pipeline, flowing from PrintProduct through PrintLayout to AI pagination and PDF generation.

**Changes**:
- PrintLayout can now link to a PrintProduct via `printProductId` field
- PrintLayout can override product constraints via `pageConstraints` field (minPages, maxPages, pageMultiple)
- When a PrintLayout is linked to a PrintProduct, leafWidth/leafHeight auto-sync from the product's trim size
- AI pagination flow now receives min/max page guidance in the prompt
- PDF generation validates page count against constraints:
  - Truncates content if over maximum (with warning)
  - Pads with blank pages if under minimum
  - Ensures page count meets pageMultiple requirement (1=any, 2=even, 4=multiple of 4)
- Warnings from PDF generation are stored and displayed in admin UI

**Files Created**:
- `src/lib/print-constraints.ts` - Constraint resolution and validation utilities

**Files Modified**:
- `src/lib/types.ts` - Added PrintLayoutPageConstraints type, extended PrintLayout and PrintStoryBook
- `src/app/admin/print-layouts/page.tsx` - Added UI for printProductId and pageConstraints
- `src/ai/flows/story-pagination-flow.ts` - Added constraint resolution and prompt guidance
- `src/app/api/storyBook/printable/route.ts` - Added constraint validation and warning generation
- `src/app/admin/print-orders/[orderId]/page.tsx` - Added PDF generation warnings display
- `docs/SCHEMA.md` - Documented new fields

---

#### `1e7a5d9` - Add test email button to admin page

**Type**: Feature

**Summary**: Added a "Send Test Email" button to the Admin Dashboard Diagnostics section to verify SMTP configuration.

**Changes**:
- Created `/api/admin/test-email` endpoint for sending test emails
- Added "Test Email (SMTP)" button in Diagnostics & Logging card
- Button sends test email to the logged-in admin's email address
- Shows appropriate success/error toasts

**Files Created**:
- `src/app/api/admin/test-email/route.ts`

**Files Modified**:
- `src/app/admin/page.tsx` - Added test email button and handler
- `docs/API.md` - Added endpoint documentation

---

#### `acbbe47` - Fix print-layout page permissions error for new model storybooks

**Type**: Bug fix

**Summary**: Fixed permissions error when accessing print-layout page from storybook viewer for new model storybooks.

**Changes**:
- The print-layout page was looking for `storybookId` query param but storybook viewer passes `storyId`
- In new model, the `bookId` URL param is the storybookId, with `storyId` in query params
- The Story document query was using the wrong ID (bookId instead of storyId)
- Now correctly detects new model mode and uses the right IDs for queries
- PrintStoryBook document now stores the correct storyId

**Files Modified**:
- `src/app/storybook/[bookId]/print-layout/page.tsx`

---

#### `730e92f` - Add Mixam API interaction logging

**Type**: Feature

**Summary**: Track all Mixam API requests, responses, and webhook events for debugging and auditing.

**Changes**:
- Added `mixamInteractions` field to `PrintOrder` type to store interaction history
- Added `MixamInteraction` type for tracking API calls and webhooks
- Created `interaction-logger.ts` helper for logging interactions to Firestore
- Added logging wrapper methods to Mixam client (`submitOrderWithLogging`, `cancelOrderWithLogging`, `getOrderStatusWithLogging`)
- Updated submit, cancel, and refresh-status API routes to use logging methods
- Updated webhook handler to log incoming webhooks
- Added "Mixam API Log" panel to print order detail page with expandable request/response viewing

**New Files**:
- `src/lib/mixam/interaction-logger.ts` - Interaction logging utilities

**Modified Files**:
- `src/lib/types.ts` - Added `MixamInteraction` type and field
- `src/lib/mixam/client.ts` - Added logging wrapper methods and types
- `src/app/api/admin/print-orders/[orderId]/submit/route.ts` - Added interaction logging
- `src/app/api/admin/print-orders/[orderId]/cancel/route.ts` - Added interaction logging
- `src/app/api/admin/print-orders/[orderId]/refresh-status/route.ts` - Added interaction logging
- `src/app/api/webhooks/mixam/route.ts` - Added webhook logging
- `src/app/admin/print-orders/[orderId]/page.tsx` - Added API log panel
- `docs/SCHEMA.md` - Documented new field and type

---

#### `fe066cf` - Switch email from Gmail to Microsoft 365 SMTP

**Type**: Configuration

**Summary**: Email notifications now use Microsoft 365/Outlook SMTP instead of Gmail.

**Changes**:
- Updated email transporter to use Microsoft 365 SMTP (smtp.office365.com:587)
- Changed environment variables from GMAIL_USER/GMAIL_APP_PASSWORD to SMTP_USER/SMTP_PASSWORD
- Created new secrets in Google Cloud Secret Manager
- Granted App Hosting access to new secrets

**Modified Files**:
- `src/lib/email/send-email.ts` - Microsoft 365 SMTP configuration
- `apphosting.yaml` - Updated secret references

**Setup Required**:
- Set SMTP_PASSWORD secret to Microsoft app password or account password

---

#### `001cfe5` - Use unified font size across all pages in print PDFs

**Type**: Enhancement

**Summary**: All pages in a printed book now use the same font size for consistent typography.

**Changes**:
- Implemented two-pass approach: first calculates minimum font size needed across ALL pages, then renders all pages at that size
- Added `calculateMinimumFontSizeForPages()` function to determine the smallest font needed
- Updated `renderCombinedPdf()`, `renderCoverPdf()`, and `renderInteriorPdf()` to accept unified font size
- Font size is calculated once and shared across all PDF outputs (combined, cover, interior)

**Modified Files**:
- `src/app/api/storyBook/printable/route.ts` - Two-pass font size calculation

---

#### `7462688` - Add auto-fit text sizing for print text boxes

**Type**: Enhancement

**Summary**: Text in text boxes now automatically reduces font size to fit all content, preventing text loss.

**Changes**:
- Added `calculateFittingFontSize()` function that iteratively reduces font size from the layout maximum (typically 24pt) down to a minimum of 10pt until all text fits within the text box
- Removed the y-position check that was silently dropping lines that fell below the text box boundary
- Empty lines are preserved for visual spacing between paragraphs

**Modified Files**:
- `src/app/api/storyBook/printable/route.ts` - Added auto-fit logic to `renderPageContent()`

---

#### `19041ce` - Fix text truncation in cover text rendering

**Type**: Bug Fix

**Summary**: Fixed truncation of cover text (e.g., `"John's Kicktastic` instead of full title with author).

**Root Cause**: The `wrapText` function split text by spaces only, embedding newline characters inside "words". When `font.widthOfTextAtSize` measured these words containing `\n`, it threw errors that were silently caught and skipped, truncating the output.

**Fix**: Split on newlines first to preserve explicit line breaks, then wrap each paragraph independently.

**Modified Files**:
- `src/app/api/storyBook/printable/route.ts` - Updated `wrapText()` function

---

#### `8833056` - Fix print pagination issues

**Type**: Bug Fix

**Summary**: Fixed three issues with print PDF generation for storybooks.

**Fixes**:

1. **Cover page order**: Changed PDF page order from back-spine-front to front-spine-back
2. **Cover text format**: Changed from `"Title"\nwritten by\nChild` to `Title\nby\nChild` (removed unnecessary quotes around title, simplified "written by" to just "by")
3. **Blank page padding**: Removed the 24-page minimum interior page requirement. Now only adds blank pages as needed to reach a multiple of 4.

**Modified Files**:
- `src/app/api/storyBook/printable/route.ts` - Cover order and padding logic
- `src/ai/flows/story-page-flow.ts` - Cover text format

---

### 2025-12-31

#### `4286dd7` - Print Order Management: Cancel, Notifications, Email

**Type**: Feature

**Summary**: Added three new features for print order management: cancel order functionality with Mixam, admin notification recipients configuration, and email notifications via Nodemailer/Gmail.

**Features**:

1. **Cancel Order with Mixam**
   - Admin can cancel orders from the print order detail page
   - Cancellation reason is required and stored
   - Calls Mixam API to cancel order (PUT /api/public/orders/{orderId}/status with "CANCELED")
   - Only available for orders not yet in production
   - Sends email notification to marked admins

2. **Admin Notification Recipients**
   - Users can be marked as "notified users" in admin user management
   - Toggle button with bell icon on each user row
   - Notified users receive email alerts for print order events

3. **Email Notifications**
   - Uses Nodemailer with Gmail SMTP
   - Sends emails on: order submission, approval, rejection, cancellation, and Mixam status changes
   - Graceful handling when credentials not configured
   - Professional HTML email templates with links to admin

**New Fields**:
- `UserProfile.notifiedUser` - Boolean flag for notification recipients
- `PrintOrder.cancelledAt` - Timestamp of cancellation
- `PrintOrder.cancellationReason` - Reason for cancellation
- `PrintOrder.cancelledBy` - Admin user ID who cancelled

**New Files**:
- `src/lib/email/send-email.ts` - Core email utility
- `src/lib/email/templates.ts` - HTML email templates
- `src/lib/email/get-notified-users.ts` - Query notified users
- `src/lib/email/notify-admins.ts` - Notification dispatcher functions
- `src/app/api/admin/print-orders/[orderId]/cancel/route.ts` - Cancel API endpoint

**Modified Files**:
- `src/lib/types.ts` - Added notifiedUser and cancellation fields
- `src/lib/mixam/client.ts` - Added cancelOrder method
- `src/app/admin/print-orders/[orderId]/page.tsx` - Added cancel button and dialog
- `src/app/admin/users/page.tsx` - Added notify toggle
- `src/app/api/webhooks/mixam/route.ts` - Added email notification
- `src/app/api/admin/print-orders/[orderId]/approve/route.ts` - Added email notification
- `src/app/api/admin/print-orders/[orderId]/reject/route.ts` - Added email notification
- `src/app/api/printOrders/mixam/route.ts` - Added email notification
- `apphosting.yaml` - Added GMAIL_USER and GMAIL_APP_PASSWORD secrets
- `docs/SCHEMA.md` - Documented new fields
- `docs/API.md` - Documented cancel endpoint

**Setup Required**:
1. Create secrets in Google Cloud Secret Manager:
   - `GMAIL_USER` - Gmail address for sending
   - `GMAIL_APP_PASSWORD` - Gmail app password (not regular password)
2. Grant access: `firebase apphosting:secrets:grantaccess`

---

#### `84436db` - Update Mixam webhook to match official API format

**Type**: Bug Fix / Enhancement

**Summary**: Rewrote Mixam webhook handler to match the actual Mixam Webhooks API format (per official documentation) and added comprehensive display of webhook data in admin UI.

**Background**: The original webhook handler was based on assumed payload format. User provided official Mixam API documentation showing the actual payload structure.

**Changes**:

Webhook Handler (`/api/webhooks/mixam`):
- Rewrote payload parsing to match official Mixam API format
- Now correctly extracts `externalOrderId` from `metadata` object
- Extracts artwork errors from `items[].errors[]` array
- Extracts shipment info from `shipments[]` array including tracking URL, courier, consignment number, parcel numbers, and shipment date
- Stores `lastWebhookPayload` and `lastWebhookAt` for debugging
- Maps Mixam statuses (PENDING, INPRODUCTION, DISPATCHED, ONHOLD, etc.) to internal statuses
- Updates `statusHistory` array with each webhook received

Admin Print Order Page:
- Added "Artwork Status" section showing artwork complete and error flags
- Added "Artwork Errors" section with detailed page-by-page error display
- Added shipment date and parcel numbers to shipping info section
- Added collapsible "Last Webhook Payload" section for debugging

**New Fields on PrintOrder**:
- `mixamArtworkComplete` - Whether artwork processing is complete
- `mixamHasErrors` - Whether there are artwork errors
- `mixamStatusReason` - Reason for current status
- `mixamArtworkErrors` - Array of `{itemId, filename, page, message}`
- `mixamShipmentDate` - Shipment date string
- `mixamParcelNumbers` - Array of parcel numbers
- `mixamShipments` - Full shipments array
- `lastWebhookPayload` - Full webhook payload for debugging
- `lastWebhookAt` - Timestamp of last webhook

**Modified files**:
- `src/app/api/webhooks/mixam/route.ts`
- `src/app/admin/print-orders/[orderId]/page.tsx`
- `docs/API.md`
- `docs/CHANGES.md`

---

#### `0c15ff5` - Fix Mixam page count mismatch and add error visibility

**Type**: Bug Fix

**Summary**: Fixed critical issue where interior PDF page count didn't match the Mixam order specification, causing order rejections. Also improved error visibility in admin UI.

**Problems Fixed**:
1. Interior PDF was generated with X pages, but Mixam order specified a different count (rounded to multiple of 4). PDFs must actually contain the number of pages specified in the order.
2. Mixam submission errors weren't prominently displayed in the admin UI.
3. Page count information wasn't visible in the order details.

**Changes**:
- Interior PDF generation now automatically adds blank padding pages to meet:
  - Minimum page count from print product configuration (e.g., 24 for hardcover)
  - Multiple of 4 requirement (pageCountIncrement from print product)
- Added `paddingPageCount` and `contentPageCount` fields to PrintableAssetMetadata
- Admin print order page now shows:
  - Prominent error display when submission fails
  - Link to Mixam order dashboard when order is submitted
  - Page count breakdown showing interior pages and padding

**Modified files**:
- `src/app/api/printStoryBooks/[printStoryBookId]/generate-pdfs/route.ts`
- `src/app/admin/print-orders/[orderId]/page.tsx`
- `src/lib/types.ts`
- `docs/SCHEMA.md`
- `docs/API.md`

---

#### `c90a3e7` - Add pagination prompt field to admin dashboard output types

**Type**: Enhancement

**Summary**: Added the missing paginationPrompt field to the Output Types editor on /admin dashboard.

**Changes**:
- Added paginationPrompt to StoryOutputForm type
- Added Textarea field in the edit dialog with helpful placeholder text
- Save handler now includes paginationPrompt in Firestore payload

**Modified files**:
- `src/app/admin/page.tsx`

---

#### `bb407a9` - Prepend output type pagination prompt to global prompt

**Type**: Bug Fix

**Summary**: The output type's `paginationPrompt` was completely replacing the global pagination prompt instead of being combined with it.

**Problem**: When a storyOutputType had a paginationPrompt (e.g., "preserve rhyming structure"), it would replace the entire base pagination instructions, losing important guidance about page structure, actor tracking, and image descriptions.

**Fix**: Now the output type's pagination prompt is **prepended** as type-specific guidance, while the global pagination prompt is always included:
1. Output type's paginationPrompt (if set) - prepended as "OUTPUT TYPE SPECIFIC INSTRUCTIONS"
2. Global pagination prompt (from system config or default) - always included as "GENERAL PAGINATION INSTRUCTIONS"

**Modified files**:
- `src/ai/flows/story-pagination-flow.ts`

---

#### `46d4080` - Fix help wizard click actions for demo data

**Type**: Bug Fix

**Summary**: The help wizard click actions were not working because the help-* demo documents (help-child, help-character) were not appearing in the parent pages.

**Root Cause**: The children and characters pages query by `ownerParentUid`, which excludes the public demo data that has no owner.

**Changes**:
- Added help-child fetch to /parent/children page
- Added help-character fetch to /parent/characters page
- Added debug logging to help-wizard click action handling

**Modified files**:
- `src/app/parent/children/page.tsx`
- `src/app/parent/characters/page.tsx`
- `src/components/help-wizard.tsx`

---

#### `b20ffc4` - Add configurable pagination prompt to admin

**Type**: Feature

**Summary**: Exposed the default pagination prompt in the System Configuration AI Prompts section, allowing admins to customize how stories are divided into picture book pages.

**Changes**:
- Added `PaginationPromptConfig` type and `DEFAULT_PAGINATION_PROMPT` constant to `types.ts`
- Created `pagination-prompt-config.server.ts` with caching for server-side config access
- Created `/api/admin/system-config/pagination-prompt` API route (GET/PUT)
- Created `/admin/pagination-prompt` page with:
  - Enable/disable toggle for custom prompt
  - Prompt editor with "Reset to Default" button
  - Info about auto-appended context and per-output-type overrides
- Added "Pagination Prompt" link to admin dashboard AI Prompts section
- Updated `story-pagination-flow.ts` to use configurable prompt with priority:
  1. Per-output-type `paginationPrompt` field
  2. System config `paginationPrompt` (if enabled)
  3. Hardcoded default

**Created files**:
- `src/lib/pagination-prompt-config.server.ts`
- `src/app/api/admin/system-config/pagination-prompt/route.ts`
- `src/app/admin/pagination-prompt/page.tsx`

**Modified files**:
- `src/lib/types.ts` - Added PaginationPromptConfig type
- `src/ai/flows/story-pagination-flow.ts` - Use configurable prompt
- `src/app/admin/page.tsx` - Added link to pagination prompt page
- `docs/SCHEMA.md` - Added systemConfig/paginationPrompt documentation
- `docs/API.md` - Added pagination-prompt API documentation

---

#### `e60390e` - Improve Output Types editor in admin dashboard

**Type**: Enhancement

**Summary**: Enhanced the Output Types inline editor in the admin dashboard to match the functionality of the dedicated `/admin/storyOutputs` page.

**Changes**:
- Added image upload capability with Upload button and hidden file input
- Replaced plain text "Default Print Layout ID" input with a Select dropdown
  that loads print layouts from Firestore
- Fixed save issue where changes to `defaultPrintLayoutId` weren't persisting
  (the field was only included in the payload when truthy, but merge updates
  require explicit values to overwrite existing data)
- Print layouts are now lazy-loaded when the edit dialog opens

**Modified files**:
- `src/app/admin/page.tsx` - Updated StoryOutputsPanel component

---

#### `0ce6ee6` - Add comprehensive database cleanup admin page

**Type**: Feature

**Summary**: Added a new admin page for identifying and cleaning up orphaned, incomplete, test, and deprecated data from the database.

**Changes**:
- Created `/api/admin/cleanup` API route with GET (scan), POST (delete selected), and DELETE (delete category) methods
- Created `/admin/cleanup` page with scan/delete UI for each category
- Scans for:
  - Orphaned children (not belonging to `parent@rcnx.io`)
  - Orphaned characters
  - Incomplete sessions (in_progress for >24 hours)
  - Orphaned stories
  - Non-production users (excluding admins)
  - Orphaned print documents
  - Old AI logs (>30 days)
  - Deprecated collections (legacy storyBooks, outputs)
- Preserves help-* IDs and admin users
- Handles subcollection deletion (messages, events, storybooks, pages, etc.)

**New files**:
- `src/app/api/admin/cleanup/route.ts`
- `src/app/admin/cleanup/page.tsx`

**Modified files**:
- `docs/API.md` - Added cleanup endpoint documentation

---

#### `4878e0d` - Add concurrency limit for ElevenLabs TTS requests

**Type**: Bug Fix

**Summary**: Fixed "too_many_concurrent_requests" error from ElevenLabs by limiting concurrent TTS requests to 3 (their limit is 5, we leave headroom for on-demand requests).

**Changes**:
- Replaced `Promise.all` with a concurrency-limited pool in `story-page-audio-flow.ts`
- Added `MAX_CONCURRENT_TTS = 3` constant
- Pages now process 3 at a time instead of all at once

**Files Modified**:
- `src/ai/flows/story-page-audio-flow.ts`

---

#### `f928846` - Fix 404 error for missing logo.svg

**Type**: Bug Fix

**Summary**: Replaced references to non-existent `/logo.svg` with existing `/icons/magical-book.svg`.

**Files Modified**:
- `src/app/story/play/[sessionId]/page.tsx`

---

#### `f7e7130` - Add fallback to draft story text when AI compilation fails

**Type**: Bug Fix / Resilience

**Summary**: When the Gemini model returns empty text or fails during story compilation, the system now falls back to using the unpolished draft story text instead of throwing an error.

**Changes**:
- Added fallback when model returns empty text on retry
- Added fallback when JSON parse fails on retry
- Added fallback for any retry errors
- Debug flags (`fallbackToDraft`) for monitoring which stories used the fallback

**Files Modified**:
- `src/ai/flows/story-text-compile-flow.ts`

---

#### `a7aafaa` - Restore pagination test admin page

**Type**: Feature Restoration

**Summary**: Restored the `/admin/paginationTest` page for testing AI-driven story pagination flows.

**Changes**:
- Created `/admin/paginationTest` page with story and output type selectors
- Created `/api/storyPagination` API route to expose `storyPaginationFlow` for testing
- Displays paginated pages with entity IDs and image descriptions
- Includes diagnostics panel for debugging

**New files**:
- `src/app/admin/paginationTest/page.tsx`
- `src/app/api/storyPagination/route.ts`

**Modified files**:
- `docs/API.md` - Added `/api/storyPagination` documentation

---

#### `f0f9718` - Simplify storybook viewer for parents

**Type**: UI Improvement

**Summary**: Removed technical clutter from the parent-facing storybook viewer.

**Changes**:
- Removed Book ID from header (not useful for parents)
- Removed image prompt display on each page
- "View Story Text" now links to the resolved story reader (`/child/{childId}/story/{storyId}/read`) instead of the legacy compiled page which was showing unresolved placeholders

**Modified files**:
- `src/app/storybook/[bookId]/page.tsx`

---

#### `d195644` - Fix "Images Still Generating" false positive on read page

**Type**: Bug Fix

**Summary**: The storybook read page incorrectly showed "Images Still Generating" even when all illustration pages were ready.

**Changes**:
- The viewer page excluded `title_page` from image readiness checks, but the read page did not
- Title pages don't have images, so including them caused the check to fail
- Aligned the read page logic with the viewer page by filtering out `title_page`, `blank`, and pages without `imagePrompt`

**Modified files**:
- `src/app/storybook/[bookId]/read/page.tsx`

---

#### `30ced48` - Add image upload to Story Output Types

**Type**: Feature

**Summary**: Admins can now upload images for story output types in addition to AI generation.

**Changes**:
- Created `/api/storyOutputTypes/uploadImage` route for uploading images
- Added Upload button alongside Generate button on story output type cards
- Images are stored in Firebase Storage at `storyOutputTypes/{typeId}/...`

**New files**:
- `src/app/api/storyOutputTypes/uploadImage/route.ts`

**Modified files**:
- `src/app/admin/storyOutputs/page.tsx`
- `docs/API.md`

---

#### `5ab5e8e` - Auto-start default help wizard for new users

**Type**: Feature

**Summary**: New users now automatically see a startup wizard when they first log in, introducing them to the app and showing them how to access Help Tours in the future.

**Changes**:
- Added `isDefaultStartup` field to `HelpWizard` type - one wizard can be marked as the default
- Added `hasCompletedStartupWizard` field to `UserProfile` to track if user has seen it
- Created `StartupWizardTrigger` component that auto-starts the wizard for new users
- Added checkbox in HelpWizardForm to set a wizard as the default startup
- Updated parent-complete-guide wizard:
  - Marked as default startup wizard
  - Added page highlighting user menu with click action
  - Added page explaining Help Tours submenu
- Added `data-wiz-target="user-menu-help-tours"` to header for Help Tours submenu

**New files**:
- `src/components/startup-wizard-trigger.tsx`

**Modified files**:
- `src/lib/types.ts` (added isDefaultStartup, hasCompletedStartupWizard)
- `src/components/admin/HelpWizardForm.tsx`
- `src/components/header.tsx`
- `src/app/providers.tsx`
- `src/data/help-wizards.json`

---

#### `7f781db` - Fix help wizard pages to use click actions for overlay dialogs

**Type**: Bug Fix

**Summary**: Help wizard pages were incorrectly navigating to routes like `/child/help-child` to show profile editing, when the actual edit UI opens as an overlay dialog via a button click on `/parent/children`.

**Changes**:
- Updated parent-complete-guide wizard to use `action: "click"` with wizard targets for child and character editing
- Added two-page pattern: first page highlights the Edit button with click action, second page describes the opened dialog
- Added wizard targets to characters page (`character-card-*`, `character-edit-*`, `characters-add-button`)
- This pattern allows wizards to demonstrate overlay-based UI correctly

**Modified files**:
- `src/data/help-wizards.json`
- `src/app/parent/characters/page.tsx`

---

### 2025-12-30

#### `fab7510` - Fix help-child profile access for wizard demos

**Type**: Bug Fix

**Summary**: Help wizard demo profiles (`help-*` IDs) were blocked by client-side ownership verification.

**Changes**:
- Added exception in `useAppContext` to allow `help-*` prefixed child profiles
- These demo profiles have public Firestore access via security rules
- Now users can navigate to `/child/help-child` during help wizard tours

**Modified files**:
- `src/hooks/use-app-context.tsx`

---

#### `5ab5e8e` - Add writer and admin help wizard guides

**Type**: Feature

**Summary**: Created comprehensive help wizards for Writers and Administrators.

**Changes**:
- **Writer's Guide to Story Design** (21 pages): Covers content creation tools
  - Story Editor overview (types, phases, prompts, outputs)
  - Creating and configuring story types
  - Writing effective AI prompts
  - Output type configuration
  - Image styles and print layouts
  - Help wizard creation
  - Testing tools (story beat, arc, compile tests)
  - Run traces and regression tests

- **Administrator's Complete Guide** (22 pages): Covers admin-only features
  - System Maintenance (users, print orders)
  - User management and role permissions
  - Print order workflow
  - System Configuration (database, global prompts, kids flows)
  - Diagnostics and logging controls
  - AI flow logs and API documentation
  - Mixam catalogue and background tasks
  - Deleted items recovery
  - Security best practices

**Modified files**:
- `src/data/help-wizards.json`

---

#### `b43ff29` - Add comprehensive help wizard guides

**Type**: Feature

**Summary**: Created two end-to-end help wizards for parents.

**Changes**:
- **Complete Parent Guide** (22 pages): Walks through all parent features
  - Setting up child profiles
  - Managing characters
  - Viewing and managing storybooks
  - Print ordering
  - Parent settings and PIN setup
  - Understanding the child dashboard

- **Your Story Adventure** (21 pages): Shows the child's story creation journey
  - Child dashboard navigation
  - Story type and mode selection
  - Character selection
  - Story generation process
  - Reading stories with read-aloud
  - Creating illustrated storybooks
  - Art style selection
  - Book reading experience
  - Print book ordering

Both wizards use the `help-*` sample data for demonstrations and include wizard target highlighting where available.

**Modified files**:
- `src/data/help-wizards.json`

---

#### `c073713` - Persist HelpWizard state to survive page navigations

**Type**: Bug Fix

**Summary**: Fixed wizard being cancelled when clicking a link that navigates to a new page.

**Changes**:
- Wizard state (id and step) is now persisted to sessionStorage
- State is hydrated from sessionStorage on component mount
- Clicking links that cause full page navigations no longer loses wizard progress

**Root cause**: When clicking a link element, the browser navigates to a new page, causing the React app to remount. Since wizard state was only in React state, it was lost. Now the state survives page navigations via sessionStorage.

**Modified files**:
- `src/hooks/use-app-context.tsx`

---

#### `af8eb3e` - Fix HelpWizard positioning and Previous button

**Type**: Bug Fix

**Summary**: Fixed HelpWizard dialog going off-screen and Previous button closing wizard instead of going back.

**Changes**:
- Dialog now measures its actual height after render and repositions accordingly
- Position is clamped to stay within viewport bounds (respects header height and margins)
- Added window resize handler to reposition dialog when viewport size changes
- "Bottom" positions now correctly place the dialog's bottom edge at the viewport bottom
- Added `goBackWizard()` function to AppContext to decrement wizard step
- Previous button now goes back a step instead of closing the wizard

**Modified files**:
- `src/components/help-wizard.tsx`
- `src/hooks/use-app-context.tsx`

---

#### `869bdaf` - Improve HelpWizard page editor UX

**Type**: Enhancement

**Summary**: Added insert page functionality and fixed data refresh after saving pages.

**Changes**:
- Added "Insert page after" button (+) to each page row for adding pages between existing steps
- Fixed page list not refreshing after saving edits (now uses `replace()` to update form state)
- Added step numbers to page list for easier identification
- Added tooltips to all page action buttons

**Modified files**:
- `src/components/admin/HelpWizardForm.tsx`

---

#### `7bc61cd` - Fix Firestore undefined field error in HelpWizard save

**Type**: Bug Fix

**Summary**: Fixed "Unsupported field value: undefined" error when saving HelpWizard pages with optional fields.

**Changes**:
- Created `removeUndefinedFields()` utility that recursively strips undefined values before Firestore save
- Created `parseFirestoreError()` utility for user-friendly error messages
- Updated HelpWizardForm to clean data before saving to Firestore
- Improved error toast messages to be more descriptive

**Root cause**: Firestore doesn't accept `undefined` values. When optional fields like `action`, `wizardTargetId`, or `highlightSelector` were not set, they had value `undefined` which caused the save to fail.

**New files**:
- None (utilities added to existing `src/lib/utils.ts`)

**Modified files**:
- `src/lib/utils.ts` - Added `removeUndefinedFields()` and `parseFirestoreError()`
- `src/components/admin/HelpWizardForm.tsx` - Use utilities when saving

---

#### `a49403d` - Improve HelpWizard click action visibility

**Type**: Enhancement

**Summary**: Improved the visibility and UX of the click action feature in HelpWizards.

**Changes**:
- Added visual badge indicator in wizard page list showing which pages have "Click" action
- Added 500ms delay after click action executes so users can see what opened
- Improved recorded step titles and descriptions:
  - Title now shows element being clicked (e.g., "Click 'user menu'")
  - Descriptions include markdown formatting and editing hints

**Modified files**:
- `src/components/admin/HelpWizardForm.tsx` - Added Click badge to page list
- `src/components/help-wizard.tsx` - Added delay after click action
- `src/hooks/use-path-recording.tsx` - Improved step titles/descriptions

---

#### `1a313d8` - Add help sample data seeding and route ID replacement

**Type**: Feature

**Summary**: Added ability to seed sample "help-*" documents for HelpWizard demonstrations, and path recording now automatically replaces dynamic IDs with help-* equivalents.

**Changes**:
- Created `help-sample-data.json` with demo documents for all major collections
- Created `/api/admin/help-sample-data` endpoint to seed/check the data
- Added "Seed Help Data" button to Help Wizards admin page
- Path recording now replaces dynamic route IDs with help-* IDs (e.g., `/child/abc123` → `/child/help-child`)

**Sample data IDs**:
- `help-child` (children)
- `help-character` (characters)
- `help-session` (storySessions)
- `help-story` (stories)
- `help-storybook` (storyBooks)
- `help-print-storybook` (printStoryBooks)
- `help-print-order` (printOrders)

**New files**:
- `src/data/help-sample-data.json`
- `src/app/api/admin/help-sample-data/route.ts`

**Modified files**:
- `src/app/admin/helpWizards/page.tsx`
- `src/hooks/use-path-recording.tsx`
- `docs/API.md`

---

#### `2dac294` - Add action field to HelpWizard for click automation

**Type**: Feature

**Summary**: HelpWizard pages can now have an `action: 'click'` property that clicks the highlighted element when the user advances. Path recording generates two steps per click: one to highlight and click, one to show the result.

**Changes**:
- Added `HelpWizardAction` type ('click') to types.ts
- Path recording now generates two pages per recorded click
- Added "Action on Advance" selector to HelpWizardPageForm
- Help wizard executes click action on advance when configured
- Added HelpWizardPage and HelpWizardPosition types to SCHEMA.md

**Modified files**:
- `src/lib/types.ts`
- `src/hooks/use-path-recording.tsx`
- `src/components/admin/HelpWizardPageForm.tsx`
- `src/components/admin/HelpWizardForm.tsx`
- `src/components/help-wizard.tsx`
- `docs/SCHEMA.md`

---

#### `36ef09f` - Add timeout and retry config to ElevenLabs TTS calls

**Type**: Bugfix

**Summary**: Added `timeoutInSeconds` and `maxRetries` options to ElevenLabs TTS calls to prevent "fetch failed" errors on Cloud Run. The default timeout was causing intermittent failures.

**Changes**:
- Added `timeoutInSeconds: 120` and `maxRetries: 2` for story audio flows
- Added `timeoutInSeconds: 60` and `maxRetries: 2` for on-demand TTS API
- Added `timeoutInSeconds: 30` and `maxRetries: 2` for voice previews

**Modified files**:
- `src/ai/flows/story-page-audio-flow.ts`
- `src/ai/flows/story-audio-flow.ts`
- `src/app/api/tts/route.ts`
- `src/app/api/voices/preview/route.ts`

---

#### `42f05e0` - Fix ElevenLabs unsupported_language error

**Type**: Bugfix

**Summary**: Removed the `languageCode: 'en-GB'` parameter from ElevenLabs TTS calls. The `eleven_multilingual_v2` model auto-detects language from text and doesn't support the `languageCode` parameter, which was causing 400 errors.

**Changes**:
- Removed `languageCode` parameter from all ElevenLabs TTS calls
- Updated comments to clarify that eleven_multilingual_v2 auto-detects language
- Fixed error: "Model 'eleven_multilingual_v2' does not support the language_code en-GB"

**Modified files**:
- `src/app/api/voices/preview/route.ts`
- `src/app/api/tts/route.ts`
- `src/ai/flows/story-audio-flow.ts`
- `src/ai/flows/story-page-audio-flow.ts`
- `src/lib/tts-config.ts`

---

#### `89ba65a` - Exclude parent PIN dialogs from path recording

**Type**: Bugfix

**Summary**: When recording a HelpWizard flow with "Save My Path", clicks on parent PIN challenge dialogs are now excluded from the recording.

**Changes**:
- Added `data-path-recording-ui` attribute to all three DialogContent variants in PinForm
- Prevents PIN verification steps from being captured in wizard recordings

**Modified files**:
- `src/components/parent/pin-form.tsx`

---

#### `385e844` - Add role field to HelpWizards

**Type**: Feature

**Summary**: Added a `role` field to HelpWizards to control visibility based on user role. Parents see only parent wizards, writers see parent and writer wizards, admins see all.

**Changes**:
- Added `HelpWizardRole` type: 'parent' | 'writer' | 'admin'
- Added `role` field to `HelpWizard` type
- Added "Audience" selector to HelpWizard editor form
- Header filters Help Tours submenu by user role
- Admin wizard list shows role badge for each wizard

**Files Modified**:
- `src/lib/types.ts` - Added HelpWizardRole type and role field
- `src/components/admin/HelpWizardForm.tsx` - Added role selector
- `src/components/header.tsx` - Filter wizards by role
- `src/hooks/use-path-recording.tsx` - Include role in downloaded wizard
- `src/app/admin/helpWizards/page.tsx` - Show role badge in list
- `docs/SCHEMA.md` - Document new field

---

#### `e3992db` - Kids PWA parity with StoryBookOutput model

**Type**: Feature / Refactor

**Summary**: Brought `/kids/*` PWA routes to feature parity with `/child/*` routes by adopting the new `StoryBookOutput` model. New books are now stored in the `stories/{storyId}/storybooks/{storybookId}` subcollection and use v2 API endpoints.

**Changes**:

**Book Creation Flow**:
- Kids style selection now creates `StoryBookOutput` documents instead of updating Story directly
- Uses `calculateImageDimensions()` from print-layout-utils for proper dimensions
- Gets `printLayoutId` from selected output type's `defaultPrintLayoutId`
- Redirects to generating page with `storybookId` query param

**Generating Page**:
- Supports both legacy and new model based on `storybookId` query param
- Uses `/api/storybookV2/pages` and `/api/storybookV2/images` for new model
- Added rate-limited state UI with "Wizard Nap Time" messaging
- Added error state handling with friendly messaging
- Auto-redirects to /kids/books on completion

**New Books List Page**:
- Created `/kids/books` page mirroring child flow
- Shows books from both legacy and new model
- Displays cover thumbnails, output type, image style badges
- Shows generation status: "Making Art", "Art Coming", "Wizard Napping"

**Reader Updates**:
- Updated to support both legacy and new page paths
- Uses `storyId` query param to distinguish new model
- Legacy path: `stories/{bookId}/pages`
- New path: `stories/{storyId}/storybooks/{storybookId}/pages`

**Navigation Updates**:
- Kids home "Read a Book" → "My Books" linking to `/kids/books`
- Kids stories removed filter tabs, simplified to show all stories
- Story cards now show "Create Book" button for stories without books
- Story cards show "Read Book", "View Progress", "Check Status" based on state

**Files Created**:
- `src/app/kids/books/page.tsx` - New books list page

**Files Modified**:
- `src/app/kids/create/[sessionId]/style/page.tsx` - Create StoryBookOutput
- `src/app/kids/create/[sessionId]/generating/page.tsx` - Dual model support, v2 APIs
- `src/app/kids/read/[bookId]/page.tsx` - Dual model page paths
- `src/app/kids/page.tsx` - Updated navigation
- `src/app/kids/stories/page.tsx` - Simplified, added action buttons

---

#### `458a137` - Add HelpWizard export/import and path recording

**Type**: Feature

**Summary**: Added two features to simplify HelpWizard creation: JSON export/import for offline editing, and "Save My Path" recording to capture user clicks and generate wizard pages automatically.

**Changes**:

**Export/Import**:
- Added Export button per wizard (downloads JSON file)
- Added Import button at page header (creates/updates wizard from JSON)
- JSON format preserves wizard ID for re-import

**Path Recording ("Save My Path")**:
- Added "Save My Path" toggle in user menu (visible when Wizard Targets enabled)
- Records ALL clicks with page route and element selector
- Auto-generates CSS selectors for elements without `data-wiz-target`
- Downloads complete HelpWizard JSON file ready for import
- Visual indicator: banner turns red and pulses during recording

**Files Created**:
- `src/lib/css-selector.ts` - CSS selector generation utility
- `src/hooks/use-path-recording.tsx` - Path recording context and logic

**Files Modified**:
- `src/app/admin/helpWizards/page.tsx` - Export/Import buttons
- `src/app/providers.tsx` - PathRecordingProvider added
- `src/components/header.tsx` - Save My Path menu item and title dialog
- `src/components/wizard-target-overlay.tsx` - Recording mode visual indicator

---

#### `89f9b8d` - Add middleware to fix double-slash URL SecurityError

**Type**: Bug Fix

**Summary**: Added Next.js middleware to redirect URLs containing double slashes to normalized versions, preventing SecurityErrors when the App Router tries to use history.replaceState with malformed URLs.

**Changes**:
- Created `src/middleware.ts` to intercept requests with double slashes
- Redirects `//api-documentation` to `/api-documentation` (and similar)
- Prevents browser SecurityError: "Blocked attempt to use history.replaceState()"

**Files Created**:
- `src/middleware.ts`

---

#### `4995cee` - Fix race condition in useTTS causing null signal error

**Type**: Bug Fix

**Summary**: Fixed a race condition in the `useTTS` hook that caused "Cannot read properties of null (reading 'signal')" errors when TTS was called rapidly or cleanup effects ran during async operations.

**Changes**:
- Store AbortController in local variable before async operations
- Use local variable for fetch signal instead of accessing ref directly
- Prevents null reference error when stop() is called during getIdToken() await

**Files Modified**:
- `src/hooks/use-tts.ts`

---

#### `5ab5e8e` - Add background music generation for story creation

**Type**: Feature

**Summary**: Added AI-generated background music to the story creation flow. Music is stored per-story-type, plays when the child's avatar animation is shown during AI processing, and automatically ducks (lowers volume) when TTS (Read to Me) is speaking.

**Changes**:
- Added `backgroundMusic` field to `StoryType` schema for storing music config
- Created `/api/music/generate` endpoint using ElevenLabs Music API
- Added Music tab to Story Types admin page with prompt editor, generate button, and preview player
- Created `useBackgroundMusic` hook with Web Audio API for volume ducking
- Integrated background music in story play page - plays during processing state when avatar is shown
- Music automatically fades in/out and ducks to 10% volume when TTS speaks

**Files Created**:
- `src/app/api/music/generate/route.ts`
- `src/hooks/use-background-music.ts`

**Files Modified**:
- `src/lib/types.ts` - Added backgroundMusic to StoryType
- `src/app/admin/storyTypes/page.tsx` - Added Music tab and BackgroundMusicEditor component
- `src/app/story/play/[sessionId]/page.tsx` - Integrated background music playback

**Documentation Updated**:
- `docs/SCHEMA.md` - Added backgroundMusic fields
- `docs/API.md` - Added Music Routes section

---

#### `5ab5e8e` - Unify TTS preference to use autoReadAloud

**Type**: Enhancement

**Summary**: Unified the TTS preference field for story play page to use `autoReadAloud` instead of `speechModeEnabled`. Both the story play page (interactive story creation) and story read page (reading completed stories) now use the same `autoReadAloud` preference. The `speechModeEnabled` field is now deprecated.

**Changes**:
- Updated `useStoryTTS` hook to check `autoReadAloud` instead of `speechModeEnabled`
- Updated `SpeechModeToggle` component to toggle `autoReadAloud` instead of `speechModeEnabled`
- Added "Read to Me" toggle to VoiceSelector in parent settings
- Added `onAutoReadAloudChange` prop to VoiceSelector component
- Updated SCHEMA.md to mark `speechModeEnabled` as deprecated

**Files Modified**:
- `src/hooks/use-story-tts.ts`
- `src/components/child/speech-mode-toggle.tsx`
- `src/components/parent/VoiceSelector.tsx`
- `src/app/parent/children/page.tsx`
- `docs/SCHEMA.md`

---

#### `ab16242` - Switch to eleven_multilingual_v2 for en-GB language support

**Type**: Bug Fix

**Summary**: Switch ElevenLabs TTS model from `eleven_turbo_v2_5` to `eleven_multilingual_v2` to support `languageCode: 'en-GB'`. The turbo model doesn't support language codes, causing voice preview and TTS generation to fail with "unsupported_language" error. The multilingual model supports 29 languages including British English.

**Changes**:
- Changed ELEVENLABS_MODEL from 'eleven_turbo_v2_5' to 'eleven_multilingual_v2'
- Retained languageCode: 'en-GB' in all TTS calls for British English pronunciation

**Files Modified**:
- `src/lib/tts-config.ts`
- `src/app/api/voices/preview/route.ts`
- `src/ai/flows/story-audio-flow.ts`
- `src/ai/flows/story-page-audio-flow.ts`
- `src/app/api/tts/route.ts`

---

#### `dc50497` - Add Secret Manager configuration for Firebase App Hosting

**Type**: Configuration

**Summary**: Configure Firebase App Hosting to inject secrets from Google Cloud Secret Manager at runtime. This enables API keys (GEMINI_API_KEY, ELEVENLABS_API_KEY, etc.) to be available to the application when deployed via App Hosting.

**Changes**:
- Added `env` section to apphosting.yaml with secret references
- Configured all required secrets: GEMINI_API_KEY, ELEVENLABS_API_KEY, FIREBASE_SERVICE_ACCOUNT_KEY, MIXAM_USERNAME, MIXAM_PASSWORD

**Files Modified**:
- `apphosting.yaml` - Added secrets configuration

**Setup Required**:
After deployment, run: `firebase apphosting:secrets:grantaccess`

---

#### `e8ba6bf` - Fix UNAUTHENTICATED error for image generation on Cloud Run

**Type**: Bug Fix

**Summary**: Fixed image generation failing with UNAUTHENTICATED error on Cloud Run. The googleAI plugin was attempting to use Application Default Credentials instead of the API key when GOOGLE_CLOUD_PROJECT was set.

**Changes**:
- Explicitly pass GEMINI_API_KEY to the googleAI plugin configuration
- Ensures API key authentication is used regardless of environment (local or Cloud Run)

**Files Modified**:
- `src/ai/genkit.ts` - Pass explicit apiKey to googleAI plugin configuration

---

### 2025-12-29

#### `5ab5e8e` - Use name pronunciation for TTS

**Type**: Enhancement

**Summary**: When resolving text for TTS (Text-to-Speech), use the character/child's `namePronunciation` field if available instead of the display name. This ensures names like "Siobhan" are pronounced correctly as "shiv-AWN".

**Changes**:
- Added `namePronunciation` field to `Character` type (children already had it)
- Created `replacePlaceholdersForTTS()` function in resolve-placeholders.server.ts
- Updated `/api/tts` route to resolve placeholders with pronunciation
- Updated `story-page-audio-flow.ts` to use TTS-specific placeholder resolution
- Extended EntityEditor to show pronunciation field for both children and characters

**Files Modified**:
- `src/lib/types.ts` - Added namePronunciation to Character type
- `src/lib/resolve-placeholders.server.ts` - Added replacePlaceholdersForTTS function
- `src/app/api/tts/route.ts` - Resolve placeholders with pronunciation
- `src/ai/flows/story-page-audio-flow.ts` - Use TTS placeholder resolution
- `src/components/shared/EntityEditor.tsx` - Show pronunciation for characters too
- `docs/SCHEMA.md` - Document namePronunciation field on characters

---

#### `5ab5e8e` - Add images to storyOutputTypes and two-step book creation flow

**Type**: Feature

**Summary**: Added image support to story output types and redesigned the create-book flow into a two-step wizard with visual card selection.

**Changes**:
- Added `imageUrl` and `imagePrompt` fields to `StoryOutputType` type
- Created API route `/api/storyOutputTypes/generateImage` for AI image generation
- Created `story-output-type-image-flow.ts` for generating display images with Gemini
- Updated admin storyOutputTypes page with:
  - Image prompt field in the editor
  - Generate Image button on each card
  - Image preview display on cards
- Redesigned `/child/[childId]/create-book/[storyId]` page:
  - Split into two separate pages/steps
  - Step 1: Card-based output type selection with images
  - Step 2: Image style selection with hover expansion
  - Auto-advance on output type selection
  - Auto-create book on image style selection
  - Full-screen loading overlay during book creation

**Files Created**:
- `src/ai/flows/story-output-type-image-flow.ts`
- `src/app/api/storyOutputTypes/generateImage/route.ts`

**Files Modified**:
- `src/lib/types.ts`
- `src/app/admin/storyOutputs/page.tsx`
- `src/app/child/[childId]/create-book/[storyId]/page.tsx`
- `docs/SCHEMA.md`

---

#### `5ab5e8e` - Use storyOutputType's printLayoutId for image dimensions

**Type**: Feature Change

**Summary**: Image dimensions for storybook generation now come from the storyOutputType's printLayoutId instead of the child's defaultPrintLayoutId.

**Changes**:
- Updated `src/app/story/[storyId]/page.tsx` to use the selected storyOutputType's `defaultPrintLayoutId` when creating storybooks
- Removed the Default Print Layout selection from the child entity editor (it was redundant since output types control this)
- Updated SCHEMA.md to reflect this change

**Rationale**: The print layout should be determined by the output type (e.g., "Picture Book" vs "Coloring Pages") rather than the child profile. This provides more consistent output dimensions based on the type of book being created.

**Files Modified**:
- `src/app/story/[storyId]/page.tsx`
- `src/components/shared/EntityEditor.tsx`
- `docs/SCHEMA.md`

---

#### `ad90320` - Add system design and change history documentation

**Type**: Infrastructure

**Summary**: Added comprehensive system design documentation and change tracking.

**Changes**:
- Created `docs/SYSTEM_DESIGN.md` with full architecture overview
  - Technology stack with rationale for choices
  - Component interactions and data flow diagrams
  - Security model and performance considerations
  - Directory structure reference
- Created `docs/CHANGES.md` for tracking changes by commit ID
  - Append-only history format
  - Template for consistent entries
- Updated `CLAUDE.md` with new documentation requirements
  - System design must be read before major work
  - Changes document updated on every push

**Files Created**:
- `docs/SYSTEM_DESIGN.md`
- `docs/CHANGES.md`

**Files Modified**:
- `CLAUDE.md`

---

#### `4e8dd88` - Add documentation infrastructure and standing rules

**Type**: Infrastructure

**Summary**: Established documentation system for maintaining codebase knowledge.

**Changes**:
- Created `docs/SCHEMA.md` - Complete Firestore schema documentation
- Created `docs/API.md` - Full API route documentation (55+ endpoints)
- Created `docs/SYSTEM_DESIGN.md` - System architecture overview
- Created `docs/CHANGES.md` - This change tracking document
- Created `CLAUDE.md` - Standing rules for development workflow
- Added `showApiDocumentation` diagnostic switch to Admin panel
- Created `/api-documentation` page (visible when switch enabled)
- Updated `DiagnosticsConfig` type with new field

**Files Modified**:
- `src/lib/types.ts`
- `src/hooks/use-diagnostics.tsx`
- `src/app/admin/page.tsx`

**Files Created**:
- `CLAUDE.md`
- `docs/SCHEMA.md`
- `docs/API.md`
- `docs/SYSTEM_DESIGN.md`
- `docs/CHANGES.md`
- `src/app/api-documentation/page.tsx`

---

#### `442599e` - Add speech mode for interactive story creation

**Type**: Feature

**Summary**: Added speech mode that reads story text and options aloud during interactive story creation.

**Changes**:
- Added `speechModeEnabled` field to `ChildProfile` type
- Implemented TTS for story text and options during play
- Added toggle in child settings

---

#### `395e188` - Add duplicate wizard feature

**Type**: Feature

**Summary**: Allow duplicating help wizards in the admin panel.

---

#### `922f63c` - Add debug logging for helpWizards fetch

**Type**: Debug

**Summary**: Added logging to troubleshoot help wizard loading issues.

---

#### `210673e` - Remove deployment timestamp from home page

**Type**: Cleanup

**Summary**: Removed build timestamp display from landing page.

---

#### `d6262b9` - Add wizard target to parent main menu

**Type**: Feature

**Summary**: Added `data-wiz-target` attribute to parent navigation for help wizard targeting.

---

#### `c145339` - Add /logout route for emergency logout access

**Type**: Feature

**Summary**: Created dedicated logout route for cases where normal logout is inaccessible.

---

#### `8b83ad4` - Add per-user wizard targets permission

**Type**: Feature

**Summary**: Added `canShowWizardTargets` field to UserProfile for editor mode access control.

---

#### `40bdccb` - Fix wizard highlight overlay using box-shadow spotlight

**Type**: Bugfix

**Summary**: Fixed visual highlight effect for wizard targets using CSS box-shadow technique.

---

#### `b35c5b4` - Add wizardTargetId and position to wizard page schema

**Type**: Schema

**Summary**: Extended `HelpWizardPage` type with `wizardTargetId` and `position` fields.

---

#### `315f34d` - Auto-save wizard to Firestore when saving a page

**Type**: Feature

**Summary**: Wizard edits now auto-save to Firestore.

---

#### `08c2fa9` - Add favicon.ico fallback to public folder

**Type**: Bugfix

**Summary**: Added favicon.ico to public folder for browsers that don't support SVG favicons.

---

#### `ae87e32` - Exclude serviceAccount.json from Docker build

**Type**: Security

**Summary**: Prevented service account credentials from being included in Docker images.

---

#### `8cf0002` - Add app options logging to debug initialization

**Type**: Debug

**Summary**: Added logging for Firebase app initialization debugging (v3).

---

#### `cca3ef4` - Add version stamp to verify-pin error response

**Type**: Debug

**Summary**: Added version identifier to PIN verification errors for debugging.

---

#### `4b745f9` - Fix Firestore auth by using applicationDefault credentials

**Type**: Bugfix

**Summary**: Fixed Firestore authentication in production by using application default credentials.

---

#### `a862f54` - Add detailed logging for PIN verification auth debugging

**Type**: Debug

**Summary**: Enhanced logging for PIN verification flow troubleshooting.

---

#### `89e991e` - Fix Firebase Admin init race condition in PIN routes

**Type**: Bugfix

**Summary**: Fixed race condition in Firebase Admin SDK initialization affecting PIN routes.

---

#### `667132d` - Add magical book favicon and PWA icons

**Type**: Feature

**Summary**: Added custom favicon and PWA manifest icons with magical book theme.

---

#### `8c15cd1` - Fix Docker build: include docs/backend.json

**Type**: Bugfix

**Summary**: Fixed Docker build by including required backend configuration file.

---

## Change Type Legend

| Type | Description |
|------|-------------|
| Feature | New functionality |
| Bugfix | Fix for existing functionality |
| Schema | Database schema changes |
| API | API route changes |
| Security | Security-related changes |
| Infrastructure | Build, deployment, documentation |
| Cleanup | Code cleanup, refactoring |
| Debug | Debugging additions (temporary or permanent) |

---

## Template for New Entries

```markdown
#### `COMMIT_ID` - Commit message summary

**Type**: Feature | Bugfix | Schema | API | Security | Infrastructure | Cleanup | Debug

**Summary**: One-line description of what changed and why.

**Changes**:
- Bullet points of specific changes

**Files Modified**:
- List of modified files (for significant changes)

**Files Created**:
- List of new files (if any)

**Breaking Changes**: (if applicable)
- Description of breaking changes

**Migration Notes**: (if applicable)
- Steps needed to migrate
```
