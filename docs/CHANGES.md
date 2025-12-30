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
