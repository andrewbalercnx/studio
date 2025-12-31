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

### 2025-12-31

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

#### `pending` - Auto-start default help wizard for new users

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

#### `pending` - Add writer and admin help wizard guides

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

#### `pending` - Add background music generation for story creation

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

#### `pending` - Unify TTS preference to use autoReadAloud

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

#### `pending` - Use name pronunciation for TTS

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

#### `pending` - Add images to storyOutputTypes and two-step book creation flow

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

#### `pending` - Use storyOutputType's printLayoutId for image dimensions

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
