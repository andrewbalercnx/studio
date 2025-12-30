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

### 2025-12-30

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
