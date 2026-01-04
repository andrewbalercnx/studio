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

### 2026-01-04

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
