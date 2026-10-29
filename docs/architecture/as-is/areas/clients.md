# As-Is: Client Surfaces (web, kids PWA, mobile)

> Scope: the client side of StoryPic Kids as it exists on 2026-10-29. That covers which surfaces exist, how each one reaches the backend, what state it keeps, and where logic is duplicated.
> The server-side areas (creation modes, storybook pipeline, characters, print, config/admin) are mapped in sibling files.
> Paths are relative to the repo root. `file:line` citations point at the line where the reference or call starts.

There are three client families:

| Family | Location | Backend access style |
|---|---|---|
| **Web app** (parent, child-mode, writer, public share) | `src/app/**` (excluding `api/` and `admin/`), `src/components`, `src/hooks` | Mostly **direct Firestore client SDK** (`useCollection` / `useDocument` from `src/lib/firestore-hooks.ts:17,76`), plus `authFetch`/`fetch` calls to `/api/*` for AI and payment operations |
| **Kids PWA** | `src/app/kids/**` (manifest `start_url: "/kids"`, `public/manifest.json:5`) | Mixed: `@storypic/api-client` via `src/contexts/api-client-context.tsx` on the read pages, direct Firestore on the create, setup and generating pages |
| **Mobile (Expo)** | `mobile/app/*` (expo-router), `mobile/src/contexts/*` | **API only**, through a hand-copied client `mobile/src/contexts/ApiClientContext.tsx` (it does *not* import the package, see `:8`) against the hard-coded base URL `https://storypic.rcnx.io` (`:5`) |

---

## 1. Inventory of user-facing surfaces

Legend: **Live** = reachable from navigation. **Live (ext)** = reached by a URL that the server or manifest generates. **Orphan** = I found no link or push to it in `src/`. **Shadow** = a static route that pre-empts a dynamic one (Next.js matches static segments first).

### 1a. Web: entry, auth, dev

| Route | Audience | Purpose | Data access | Live? (evidence) |
|---|---|---|---|---|
| `/` `src/app/page.tsx` | parent | Child picker / home; redirects admins to `/admin` | FS read `children` (`:68`) | Live (home) |
| `/login`, `/signup`, `/logout` | public | Firebase Auth email login and signup. Signup writes `users/{uid}` and sets the PIN | FS `setDoc users` (`signup/page.tsx:60`), `/api/parent/set-pin` | Live (header `header.tsx:306`, `login/page.tsx:76`). `/logout` has no links (orphan) |
| `/install` | parent | APK download page | static | Live (header menu `header.tsx:254`) |
| `/api-documentation` | dev | Renders API docs when `systemConfig/diagnostics.showApiDocumentation` is set | `useDiagnostics` (FS) (`:149`) | Orphan by design (typed URL, per CLAUDE.md) |
| `/firestore-test` | dev | Firestore-rules smoke test. Writes test docs to `children`, `storySessions`, `characters`, `stories`, `printOrders`, `storyBooks`, `printProducts` (`:310-405`) | FS CRUD | Linked only from `/admin/dev` (`admin/dev/page.tsx:104`) |
| `/writer` `src/app/writer/page.tsx` | writer/admin | Edits `storyPhases`, `promptConfigs`, `storyOutputTypes` and reads `printLayouts` | FS read+write (`:292-864`), `/api/storyOutputTypes/{generateImage,uploadImage}` | Live for writers (`header.tsx:154,247`) |

### 1b. Web: parent console (`src/app/parent/*`, wrapped in `<ParentGuard>` at `parent/layout.tsx:53`)

| Route | Purpose | Data access | Live? |
|---|---|---|---|
| `/parent` | Overview and child cards ("play as child") | FS `children` (`parent/page.tsx:56`) | Live (nav `parent/layout.tsx:11`). Its link to `/parent/diagnostics` (`:79`) is **broken**, because no such page exists |
| `/parent/children` | Child CRUD, photos, avatars, soft delete and undo | FS onSnapshot + `updateDoc`/`setDoc` (`:433-664`) via `EntityEditor`. `/api/generateAvatar[/animation]`, `/api/children/photos` | Live |
| `/parent/characters` | Character CRUD, soft delete and undo | FS `characters`, `children` (`:73-172`) via `EntityEditor` | Live |
| `/parent/storybooks` | Per-child list of books | `/api/children` (`:31`) | Live |
| `/parent/storybooks/[childId]` | Book grid: thumbnails, audio, printable PDF, soft delete | `/api/parent/storybooks[/thumbnails]`, `/api/storyBook/{pageAudio,printable}`. **Soft delete/undo writes FS directly** (`:532,552`). FS reads `imageStyles`, `printLayouts` (`:279,285`) | Live |
| `/parent/orders` | Print orders, pay, tickets | `/api/printOrders/my-orders`, `/api/printOrders/{id}/pay`, `/api/tickets` (`:93-157`) | Live |
| `/parent/settings` | PIN, voice | FS `users` onSnapshot (`:30`), `/api/parent/set-pin`, `VoiceSelector` → `/api/voices/*` and **`/api/admin/system-config/voice`** | Live |

### 1c. Web: "child mode" shell (`/child/[childId]/*`, no layout; header switches on `roleMode`)

| Route | Purpose | Data access | Live? |
|---|---|---|---|
| `/child/[id]` | Child dashboard with story and book counts | FS `stories`, plus an N+1 `getDocs` over `stories/{id}/storybooks` (`:40,73`) | Live (`page.tsx:25`, `parent/page.tsx:27`, header `:186`) |
| `/child/[id]/stories` | Story list; inline title edit | FS `stories`, `storyGenerators`. `updateDoc stories.metadata.title` (`:101`). `/api/storyBook/{audio,actorAvatar}` | Live (`child/[id]/page.tsx:157`) |
| `/child/[id]/story/[storyId]/read` | Read the story text with TTS | FS `stories`. Writes `children.autoReadAloud` (`:98`) | Live (`components/child/story-card.tsx:314`) |
| `/child/[id]/create-book/[storyId]` | Pick output type and art style, **creates the storybook doc on the client** | FS `addDoc stories/{id}/storybooks` (`:224`), `getDoc printLayouts` (`:214`) | Live (`story-card.tsx:322`) |
| `/child/[id]/book/[sbId]/generating` | Progress, triggers pages and images | FS listeners. `/api/storybookV2/{pages,images}` | Live (`create-book:250`) |
| `/child/[id]/books` | "My Books" grid | FS N+1 aggregation (`:68-173`) | Live (`child/[id]/page.tsx:166`) |
| `/child/[id]/book/[sbId]/play` | Immersive reader | FS `stories/.../storybooks/.../pages` and the legacy `outputs/storybook/pages` (`:62,68`) | Live (`books/page.tsx:314`) |

### 1d. Web: story creation (`/story/*`, used by child mode)

| Route | Purpose | Data access | Live? |
|---|---|---|---|
| `/story/start` | Generator chooser | `/api/kids-generators` | Live (`child/[id]/page.tsx:149`, `stories/page.tsx:263`) |
| `/story/start/[generatorId]` | Creates the session on the client, then pushes `/story/{gen}/{session}` | FS batch `storySessions` + `children/{id}/sessions` (`:92,115`). **Writes `children.ownerParentUid`** (`:83`) | Live (`start/page.tsx:127`) for generators without a static page (e.g. `beat`) |
| `/story/start/{wizard,friends,gemini3,gemini4,chat}` | Per-generator copies of the above | Same pattern. wizard and friends mirror into `children/{id}/sessions`, while gemini3, gemini4 and chat **do not** (grep: 0 `'sessions'` refs). chat reads `promptConfigs` (`chat/page.tsx:56,69`) | **Shadow**: reached via `/story/start/${generator.id}` when the id matches. Never linked by name |
| `/story/[generatorId]/[sessionId]` (folder is named `[storyId]`) | Unified `StoryBrowser` host | FS session, child, `storyOutputTypes` (`:36-57`). `/api/storyCompile` | Live (`start/[generatorId]:124`) |
| `/story/wizard/[sid]`, `/story/friends/[sid]` | Older per-generator `StoryBrowser` hosts | as above | **Shadow** of the route above. Reached only from `start/wizard:93` and `start/friends:90` |
| `/story/play/[sid]` | `StoryBrowser` host (gemini3/4, chat, and **kids PWA non-wizard flows**) | FS session, child, `storyTypes` | Live (`kids/create/page.tsx:302`, `start/gemini3:71`) |
| `/story/session/[sid]` (1,587 lines) | Legacy "chat" session page: warmup, beats, character traits, ending, compile, legacy storyBook pages/images | FS heavy read/write (see section 2). Ten API routes | Live but legacy (`stories/page.tsx:117`, "Diagnostic View" `story-browser.tsx:1130`) |
| `/story/session/[sid]/{generating,compiled,select-image-style}` | Legacy single-book pipeline | FS plus **`POST /api/storyBook/pages` and `/api/storyBook/images`, which no longer exist** (see section 6) | Reached from the legacy session page and `/stories` |
| `/story/session/[sid]/select-output-type` | Legacy output-type picker | FS `updateDoc storySessions` | **Orphan** (no links) |
| `/story/type/[sid]` | Legacy story-type picker | FS `updateDoc storySessions` (`:125`) | Only from the legacy session page (`session/page.tsx:1501`) |
| `/story/[storyId]` | Parent-ish story viewer, lists books, creates a storybook on the client | FS `addDoc stories/{id}/storybooks` (`:119`) | Live (`parent/orders/page.tsx:320`, print pages, `/stories`) |
| `/story/[storyId]/storybook/[sbId]/generating` | Progress (duplicate of the child version) | FS + `/api/storybookV2/*` | Live (`story/[storyId]/page.tsx:149`) |
| `/stories` | Session and story list for the active child. Redirects to `/child/{id}` in child mode (`:139`) | FS `children/{id}/sessions`, `stories` (`:146,156`) | Live (many "Back to stories" links, e.g. `storybook/[bookId]/page.tsx:560`) |

### 1e. Web: book management, print, share (`/storybook/*`)

| Route | Audience | Purpose | Data access | Live? |
|---|---|---|---|---|
| `/storybook/[bookId]` (944 lines) | parent | Book detail: progress, retry, page edit, audio, finalize, share, print entry | FS listeners + `updateDoc artStatus.recoveryNotified` (`:191`). `/api/storybookV2/{pages,images,finalize,pageEdit}`, `/api/storyBook/{pageAudio,share}` | Live (`parent/storybooks/[childId]:150`) |
| `/storybook/[bookId]/read` | parent | `BookReader` | FS pages (new and legacy paths `:59,65`) | Live |
| `/storybook/[bookId]/print-layout` | parent | Choose a layout. **Creates `printStoryBooks` on the client** (`:155`) | FS + `/api/printStoryBooks/{id}/auto-layout` | Live (`storybook/[bookId]/page.tsx:768`) |
| `/storybook/[bookId]/print-layout/[psbId]/pages` | parent | Review PDFs | FS `printStoryBooks` (`:34`), `/api/printStoryBooks/{id}/generate-pdfs` | Live |
| `/storybook/[bookId]/order` | parent | Order form | `/api/printOrders/{mixam,products}`, `/api/user/addresses`, `/api/storyBook/{id}` | Live |
| `/storybook/share/[shareId]` | **public** | Passcode-protected shared reader (`ImmersivePlayer`) | `GET /api/storyBook/share` only. No Firebase providers (`providers.tsx:21`) | Live (ext): URL minted by `api/storyBook/share/route.ts:207` |

### 1f. Kids PWA (`src/app/kids/*`, own layout and context `kids/layout.tsx`)

| Route | Purpose | Data access | Live? |
|---|---|---|---|
| `/kids` | Kid home with Create, My Stories and My Books tiles | context only | Live (PWA `start_url`) |
| `/kids/setup` | Parent locks the device to a child. Switching child requires the PIN (`verifyParentPin`, `:73`) | FS `children` (`:33,43`) + client filter `!deletedAt` (`:53`) | Live (`kids/page.tsx:26,142`) |
| `/kids/create` (768 lines) | Generator chooser. Wizard Q&A runs inline. Other generators **leave the PWA** to `/story/play/{id}` (`:302`) | `/api/kids-generators`, `/api/entitlements/check`, `/api/storyCompile`. **FS batch creates the session and its mirror** (`:261,290,343,363`) | Live |
| `/kids/create/[sid]/style` | Output type and art style, then create the storybook | api-client `getOutputTypes`/`getImageStyles`/`createStorybook` (→ `/api/storybookV2/create`). FS reads session and story (`:73,80`). Client filters `status==='live'` (`:97`) and by age (`:127`) | Live (`create/page.tsx:488`) |
| `/kids/create/[sid]/generating` | Progress, triggers generation | FS listeners (`:56-70`). `/api/storybookV2/*`, plus the **dead** legacy `/api/storyBook/{pages,images}` (`:160,218`) | Live |
| `/kids/stories` | Story list | api-client `getMyStories` | Live |
| `/kids/story/[storyId]/read` | Story text reader | api-client + FS write `children.autoReadAloud` (`:119`) | Live (`kids/stories/page.tsx:279`) |
| `/kids/books` | "My Books" | api-client: stories, then per-story `getMyStorybooks(includeAll)`. Client filter, sort and aggregation (`:116-152`) | Live |
| `/kids/read/[bookId]` | Immersive reader | api-client only (`:54-56`) | Live (`generating:305`) |
| `/kids/play/[sessionId]` | `StoryBrowser` inside the PWA | FS (`:32-46`) | **Orphan**: `kids/create` pushes to `/story/play` instead |

### 1g. Mobile (Expo, `mobile/app/*`)

All screens are child-facing (a parent logs in once). Every screen uses `MobileApiClient`. None use the Firestore SDK.

| Screen | Purpose | API calls |
|---|---|---|
| `index` / `_layout` | Auth and child routing (`index.tsx:17-23`) | none |
| `login` | Email and password login via Identity Toolkit REST (`AuthContext.tsx:117`), with tokens in SecureStore | Google REST |
| `select-child` | Choose a child; switching requires the PIN | `GET /api/children`, `POST /api/parent/verify-pin` |
| `home` | Create, Stories and Books tiles | none |
| `create` | Generator list → `POST /api/storySession` (`create.tsx:58`) | `/api/kids-generators`, `/api/storySession` |
| `play/[sessionId]` | Q&A. **Always calls `/api/storyWizard`** whatever the generator (`play:59,81`) | `/api/storyWizard` |
| `stories`, `story/[storyId]` | List and detail | `/api/stories?childId`, `/api/stories/{id}`, `/api/stories/{id}/storybooks` |
| `create-book/[storyId]` | Output type and style | `/api/storyOutputTypes`, `/api/imageStyles`, `/api/storybookV2/create` |
| `generating/[storyId]` | Trigger generation and poll | `/api/storybookV2/{pages,images}` |
| `books`, `book/[storyId]` | My Books and the reader | `/api/stories*`, `/api/stories/{id}/storybooks/{sb}/pages` |

---

## 2. Data access per surface

### 2a. Collection → client files with direct SDK access (web and PWA; admin pages excluded)

| Collection / path | Client readers | Client writers |
|---|---|---|
| `children` | `hooks/use-app-context.tsx:70`, `kids/layout.tsx:64`, `app/page.tsx:68`, `parent/page.tsx:56`, `parent/children:560`, `parent/characters:78`, `kids/setup:33`, `kids/create:250`, `kids/play:39`, `story/start/*` (`[generatorId]:72`, `gemini3/4,chat:39`, `wizard:43`, `friends:42`), `story/{play,wizard,friends,[id]/[sid]}`, `story/session/[sid]:233`, `select-image-style:65`, `story/type:93`, `story/[storyId]:50`, `storybook/[bookId]:208`, `child/create-book:95`, `hooks/use-resolve-placeholders.ts:36`, `lib/resolve-placeholders.ts:37,70`, `story-browser.tsx` | `parent/children` (photos, avatar, soft delete/restore `:433-664`), `components/shared/EntityEditor.tsx:297-508` (create/update), `components/child/speech-mode-toggle.tsx:43`, `story-browser.tsx:258` (`musicEnabled`), `kids/story/read:120` and `child/story/read:99` (`autoReadAloud`), **`story/start/*` backfill of `ownerParentUid`** (`[generatorId]:83`, `gemini3:50`, `gemini4:50`, `chat:50`, `wizard:54`, `friends:53`) |
| `children/{id}/sessions` (mirror) | `stories/page.tsx:146` | `kids/create:290,363`, `story/start/[generatorId]:115`, `story/start/wizard:84`, `story/start/friends:82` |
| `characters` | `parent/characters:73,94` (`help-character`), `story-browser:209`, `story/session/[sid]:364,588`, `storybook/[bookId]:217`, placeholder resolvers | `parent/characters:158,170` (soft delete/undo), `EntityEditor`, `story/session/[sid]:365,589` (traits) |
| `storySessions` | `story-browser:167`, `kids/play:32`, `kids/create:445`, `kids/create/[sid]/{style:73,generating:56}`, `story/{play,wizard,friends,[id]/[sid]}`, `story/session/*`, `story/type:89` | **Create**: `kids/create:261,343`, `story/start/*` (7 pages). **Update**: `story-browser:481,913,956,1002`, `story/session/[sid]` (11 `updateDoc`), `select-output-type:24`, `story/type:125`, `select-image-style:108` |
| `storySessions/{id}/messages` | `story-browser:438`, `story/session/[sid]:231` | `story-browser:439-469` (batch of AI-returned messages), `:684,809`; `story/session/[sid]` (13 `addDoc`) |
| `storySessions/{id}/events` | — | `lib/session-events.ts:27` (only from `story/session/[sid]`) |
| `stories` | `child/[id]/page:40`, `child/[id]/stories:56`, `child/[id]/books:68`, `child/story/read:53`, `child/create-book:78`, `child/book/*`, `stories/page:156`, `story/[storyId]:46`, `story/session/*/{generating,compiled,select-image-style}`, `storybook/[bookId]{,/read,/print-layout}`, `kids/create/[sid]/{style,generating}` | `child/[id]/stories:101` (title), `select-image-style:108` (`setDoc` on story/session) |
| `stories/{id}/storybooks` | `child/[id]/page:73`, `child/books:141`, `child/book/*`, `story/[storyId]:57`, `storybook/[bookId]:109`, `storybook/.../print-layout:62`, `kids/create/[sid]/generating:70` | **Create**: `story/[storyId]/page.tsx:119`, `child/create-book:224`. Update: `storybook/[bookId]:191`, `parent/storybooks/[childId]:532,552` (soft delete) |
| `stories/{id}/storybooks/{sb}/pages` | `storybook/[bookId]:117`, `storybook/read:59`, `child/book/play:62`, `child/books` (cover) | — |
| `stories/{id}/outputs/storybook/pages` (legacy) | `storybook/read:65`, `child/book/play:68`, `story/session/compiled:30`, `child/books` (cover) | — |
| `storyGenerators` | `story-browser:161`, `story/[id]/[sid]:36`, `story/start/[generatorId]:38`, `child/stories:69` | — |
| `storyTypes` | `story-browser:174,931`, `story/play:49`, `kids/play:46`, `story/session/[sid]:235,791`, `story/type:97` | — |
| `storyOutputTypes` | `story-browser:182`, `story/{wizard,friends,[id]/[sid]}`, `story/[storyId]:66`, `select-output-type:30`, `child/create-book:107`, `child/books:79`, `storybook/[bookId]:121`, `writer:678` | `writer:862-864` |
| `imageStyles` | `story/[storyId]:73`, `select-image-style:74`, `child/create-book:124`, `child/books:85`, `parent/storybooks/[childId]:279` | — |
| `printLayouts` | `story/[storyId]:109`, `child/create-book:214`, `storybook/.../print-layout:90`, `parent/storybooks/[childId]:285`, `writer:706` | — |
| `printStoryBooks` | `storybook/.../print-layout/[psbId]/pages:34` | `storybook/[bookId]/print-layout:129,155` |
| `answerAnimations` | `story-browser:189` | — |
| `promptConfigs` | `story/start/chat:56,69`, `writer:477` | `writer:545-547` |
| `storyPhases` | `writer:292` | `writer:348-350` |
| `helpWizards` | `components/header.tsx:69`, `help-wizard.tsx:80`, `startup-wizard-trigger.tsx:54`, `onboarding-tip-trigger.tsx:61` | — |
| `users` | `parent/settings:30`, `components/parent/pin-form.tsx:61`, `hooks/use-admin-status.tsx:46`, `startup-wizard-trigger:34`, `onboarding-tip-trigger:53` | `signup:60`, `startup-wizard-trigger:97` (`hasCompletedStartupWizard`) |
| `systemConfig/diagnostics` | `hooks/use-diagnostics.tsx:39` (global provider) | `use-diagnostics.tsx:60` (admin toggle) |

Mobile reads and writes **no** Firestore collections directly.

### 2b. API routes per client (outside the admin area)

- **Web, AI/creation**: `/api/kids-generators`, `/api/storyCompile`, `/api/storyBeat`, `/api/storyEnding`, `/api/ai-warmup`, `/api/warmupReply`, `/api/characterTraits`, `/api/characters/create`, `/api/generateCharacterAvatar`, `/api/generateAvatar[/animation]`, `/api/regenerate-image-description`, and generator-specific endpoints taken from `storyGenerators.apiEndpoint` (`story-browser.tsx:394,550,1025`).
- **Web, books**: `/api/storybookV2/{pages,images,finalize,pageEdit}`, `/api/storyBook/{pageAudio,audio,actorAvatar,share,printable,[bookId]}`, `/api/parent/storybooks[/thumbnails]`, `/api/printStoryBooks/{id}/{auto-layout,generate-pdfs}`.
- **Web, commerce/account**: `/api/printOrders/{my-orders,mixam,products,[id]/pay}`, `/api/tickets`, `/api/user/{addresses,onboarding}`, `/api/postcode/lookup`, `/api/entitlements/{check,summary}`, `/api/feedback[/eligibility,/testimonial]`, `/api/report-issue`, `/api/voices/{clone,preview}`, `/api/tts`.
- **Web, session/infra**: `/api/persona` (`lib/persona-client.ts:28`), `/api/flags` (`hooks/use-feature-flag.ts`), `/api/parent/{set-pin,verify-pin}`, `/api/children`, `/api/children/photos`, `/api/characters/photos`.
- **Kids PWA via api-client**: `/api/kids-generators`, `/api/storyOutputTypes`, `/api/imageStyles`, `/api/stories`, `/api/stories/{id}`, `/api/stories/{id}/storybooks`, `/api/stories/{id}/storybooks/{sb}/pages`, `/api/storybookV2/create`.
- **Mobile**: the same set, plus `/api/storySession`, `/api/children[/{id}]`, `/api/storyWizard`, `/api/parent/verify-pin`. `/api/storyBeat` and `/api/storyFriends` are defined but no screen calls them.
- A **parent** component calls an **admin** route: `VoiceSelector` → `/api/admin/system-config/voice`.

### 2c. Server-first violations (business logic on the client)

1. **Session creation in 8 client places** with diverging document shapes. These are `kids/create:261-290` and `:343-363`, `story/start/[generatorId]:92-115`, and `story/start/{wizard,friends,gemini3,gemini4,chat}`. They also differ from `POST /api/storySession` (`api/storySession/route.ts:58-68`), which is used only by mobile:
   - The status values differ: the client writes `status:'in_progress'` and the server writes `'active'`.
   - The generator field differs: the client writes `storyMode`/`currentPhase:<gen>` and the server writes `generatorId`/`flowType`/`currentPhase:'warmup'`.
   - The child mirror is inconsistent: only some client paths write it, and the server never does.
   - Only the kids PWA enforces the entitlement gate (`kids/create/page.tsx:239`). The web `/story/start/*` paths have no `entitlements` reference.
2. **The client claims ownership.** Five `story/start/*` pages `updateDoc(child, {ownerParentUid: user.uid})` when the field is missing (e.g. `[generatorId]:83`).
3. **Storybook creation on the client**, including the print-layout lookup and the image-dimension maths. This happens in `story/[storyId]/page.tsx:100-135` and `child/create-book:198-238`, while `/api/storybookV2/create` already does the same job for the PWA and mobile (`packages/api-client/src/client.ts:283`).
4. **The client persists the AI conversation.** `story-browser.tsx:439-481` writes the generator's response options and messages into `storySessions/{id}/messages` and `arrayUnion`s `actors` onto the session. `story/session/[sid]` does the same thing more than 20 times. It also writes character traits onto `characters` (`:589`).
5. **"My Books" aggregation and status derivation** is done in four places, with three different readiness rules:
   - `child/[id]/books:116-173` uses N+1 `getDocs`, keeps a book when `page OR image ready`, and sorts.
   - `child/[id]/page.tsx:72-96` counts **only `imageGeneration==='ready'`**, so the count disagrees with the list.
   - `kids/books:116-152` uses the API with `includeAll` and re-filters `page OR image ready`. This bypasses the server's ready-only default (`client.ts:371-379`).
   - `mobile/app/books.tsx:53-83` keeps a book when `image ready` only.
6. **Client-side soft-delete filtering** in `parent/page:63`, `parent/children:674`, `parent/characters:181,186`, `kids/setup:53`, `parent/storybooks:36`, and `child/stories:87`. **Client-side soft delete writes** happen in `parent/storybooks/[childId]:532`, `parent/characters:159`, and `parent/children:650`.
7. **Placeholder resolution on the client** in `hooks/use-resolve-placeholders.ts` and `lib/resolve-placeholders.ts`, which read `children`/`characters` and are used by the story-card, readers and page editor. Meanwhile the API resolves placeholders server-side for api-client consumers (`client.ts:341,356`).
8. **Catalog filtering and sorting on the client**: output types (`kids/create/[sid]/style:97` filters `status==='live'`), age-appropriate styles (`:127`), sort order (`child/create-book:116,131`), and generator enablement (`mobile/app/create.tsx:42`).
9. **Progress counts derived on the client** from page docs (`storybook/[bookId]/page.tsx:232-243`).

---

## 3. Duplication across web, kids PWA and mobile

| Feature | Web (child mode `/child`, `/story`) | Kids PWA (`/kids`) | Mobile | Divergence |
|---|---|---|---|---|
| Choose / lock child | `AppContext.setActiveChildId` → `localStorage.activeChildId` (`use-app-context.tsx:89`). Pickers in `app/page.tsx`, `parent/page.tsx`, `parent/children:604` | `KidsPWAContext.lockToChild` → `localStorage.kids_pwa_child_id` (`kids/layout.tsx:25,95`). Picker in `/kids/setup` | `ChildContext` → SecureStore `storypic_selected_child` (`ChildContext.tsx:28`) | Three independent stores. Ownership is checked by a FS read (web, PWA) or by the API (mobile). The persona cookie is synced from web and PWA only |
| Start a story | 8 client FS session creators (section 2c.1). `/story/start` chooser | `kids/create` (FS batch + entitlement gate) | `POST /api/storySession` | Different shapes, gating and mirror behaviour |
| Play the session | `StoryBrowser` (any generator, `apiEndpoint` from config) in 4 host routes (+1 orphan in the PWA) and the legacy `story/session/[sid]` | Wizard inline in `kids/create`. Other generators **exit the PWA** to `/story/play` | `play/[sessionId]` calls `/api/storyWizard` only | Mobile supports only wizard-style flows. Its `sendBeatChoice` posts `optionId` while the server reads `selectedOptionId` (`api/storyBeat/route.ts:15`) |
| Create a book | Client `addDoc` (`story/[storyId]`, `child/create-book`) | `/api/storybookV2/create` | `/api/storybookV2/create` | Two implementations of the layout and dimension logic |
| Generation progress | `child/book/*/generating` (592 lines), `story/[id]/storybook/*/generating`, legacy `story/session/*/generating` | `kids/create/[sid]/generating` (637 lines; also triggers the dead legacy endpoints) | `generating/[storyId]` (polls via the API) | Four progress pages. Web and PWA use FS listeners plus client-triggered `/pages` → `/images` |
| Read a book | `child/book/play` (`ImmersivePlayer`), `storybook/[id]/read` (`BookReader`), `storybook/[id]` (`ParentBookView`) | `kids/read/[bookId]` (`ImmersivePlayer`, via API) | `book/[storyId]` (505 lines, own RN reader) | Web readers query pages via FS and handle the legacy `outputs/` path. PWA and mobile use the API's pages endpoint, which filters and sorts server-side |
| Read story text | `child/[id]/story/[sid]/read` (403 lines) | `kids/story/[sid]/read` (395 lines) | `story/[storyId]` | The two web files are near copies (diff of about 500 lines, mostly context and data-source swaps). Both write `autoReadAloud` directly |
| Story list | `child/[id]/stories` (FS), `/stories` (FS sessions mirror) | `kids/stories` (API) | `stories` (API, client sort `:45`) | Different sources (`stories` vs `children/{id}/sessions`) |
| Parent PIN | `ParentGuard` + `/api/parent/verify-pin`, 5-minute grace in sessionStorage (`parent-guard-logic.ts:13`) | `verifyParentPin` in `kids/setup:73` | `ChildContext.verifyPinAndSwitch` | Three UIs over one endpoint |
| API client | `@storypic/api-client` (PWA only) | — | `MobileApiClient` hand copy | See section 5 |

---

## 4. App-wide client state

Web provider stack (`src/app/providers.tsx:41-66`): `FirebaseClientProvider` › `AppContextProvider` › `DiagnosticsProvider` › `PostHogAnalyticsProvider` › `WizardTargetDiagnosticsProvider` › `PathRecordingProvider` › `ParentGuardProvider`, plus the global `Header`, `HelpWizard`, `WizardTargetOverlay`, `StartupWizardTrigger`, `ConsentBanner` and `FirebaseErrorListener`. `/storybook/share/*` bypasses the whole stack (`:21-39`). The kids layout adds `KidsPWAContext` and `ApiClientProvider` *inside* that same stack (`kids/layout.tsx:131-134`), so the PWA still mounts the parent header and guard providers.

| State | Where | Persistence | Notes |
|---|---|---|---|
| `roleMode` (`unknown`/`parent`/`child`/`writer`/`admin`) | `hooks/use-app-context.tsx:136-147` | derived | `admin`/`writer` come from token claims. `child` requires `activeChildId` **and** a FS-loaded profile owned by the user (`:82`) |
| `activeChildId` / `activeChildProfile` | `use-app-context.tsx:29,70` | `localStorage.activeChildId` | Mirrored to an httpOnly persona cookie via `POST/DELETE /api/persona` (`lib/persona-client.ts`). The mirror is fire-and-forget and fails open |
| Help wizard `activeWizard {id, step}` | `use-app-context.tsx:30-62` | `sessionStorage.activeWizard` | Wizard definitions come from FS `helpWizards`. The startup wizard flag lives on `users.hasCompletedStartupWizard` |
| Parent PIN guard | `hooks/use-parent-guard.tsx` + `parent-guard-logic.ts` | `sessionStorage storypic.parentGuard.lastValidatedAt:{uid}`, 5 minutes | Applied in the `/parent` layout and in individual `/storybook/*` pages and the header |
| Kids PWA lock | `kids/layout.tsx` `KidsPWAContext` | `localStorage.kids_pwa_child_id` | Independent of `activeChildId`. If the PWA hands off to `/story/play`, that page uses `AppContext`, not the PWA lock |
| Diagnostics switches | `hooks/use-diagnostics.tsx` | FS `systemConfig/diagnostics` (realtime) | Global, read by every visitor |
| Feature flags | `hooks/use-feature-flag.ts` → `/api/flags`, 30-second module cache | memory | **No consumers** in `src/` (grep for `useFeatureFlag(` finds only the definition) |
| Path recording / wizard target diagnostics | `hooks/use-path-recording.tsx`, `use-wizard-target-diagnostics.tsx` | memory | Tools for authoring help wizards. Mounted globally for all users |
| Mobile | `AuthContext` (REST auth, SecureStore tokens), `ChildContext`, `ApiClientContext` | SecureStore | No persona cookie, so the server falls back to parent-only scope (`api/storySession/route.ts:38-40` comment) |

**How "parent mode" and "child mode" are represented**: there is no route-level separation.
- Child mode is `roleMode==='child'`, which means `activeChildId` is set. The header switches its home link (`header.tsx:186`) and shows "Return to Parent" / "Switch to Parent" (`:202,209`).
- `/child/[childId]/*` pages call `setActiveChildId(routeChildId)` on mount (e.g. `child/[id]/page.tsx:30`).
- `/stories` redirects into child mode (`stories/page.tsx:136-140`).
- Parent mode is "no active child" plus the PIN guard on `/parent/*`.
- The kids PWA uses a parallel "locked device" concept. Mobile uses a "selected child" concept.

---

## 5. `packages/api-client` and `packages/shared-types`

- **Wiring**: npm workspaces (`package.json:5-6`). `dist/` is checked in (`packages/api-client/dist/*`).
- **api-client** (`packages/api-client/src/client.ts`, 397 lines) is described as covering "child-facing features". It provides:
  - discovery (`getGenerators`, `getOutputTypes`, `getImageStyles`);
  - generator turns (`sendWizardChoice`, `sendBeatChoice`, `sendFriendsAction`, `sendGemini3Choice`, `sendGemini4Choice`) and `compileStory`;
  - storybook (`createStorybook`, `generatePages`, `generateImages`, `getStorybookPages`);
  - reading (`getStory`, `getMyStories`, `getMyStorybooks`);
  - `speak`.
- **Consumers**: only `src/contexts/api-client-context.tsx` → the five kids pages (`kids/books`, `kids/stories`, `kids/read/[bookId]`, `kids/story/[id]/read`, `kids/create/[sid]/style`). The rest of the web app does not use it. Mobile does not use it either. `MobileApiClient` re-implements it with `any` types (`mobile/src/contexts/ApiClientContext.tsx:8`).
- **Drift between api-client and the API**:
  - `createSession` throws 501 "create session via Firestore" (`client.ts:183-186`), although `POST /api/storySession` exists and mobile uses it.
  - `getStorybookStatus` throws 501 (`:326-336`).
  - The package has no children, characters, PIN, persona, entitlement, print or orders methods.
  - `generatePages` and `generateImages` send `storyOutputTypeId` and `imageStyleId`. The routes read these from the storybook doc instead (`api/storybookV2/pages/route.ts:162`, `images/route.ts:481`), so the fields are ignored.
- **Drift between mobile and the API**: `sendBeatChoice` sends `optionId`, but `/api/storyBeat` reads `selectedOptionId`. The mobile copy has no `sendGemini*` methods. It does have `getChildren`, `getChild` and `verifyPin`, which the package lacks.
- **shared-types vs `src/lib/types.ts`**:
  - `src/lib/types.ts` (2,649 lines) is the type source for the whole web app and server. shared-types (607 lines) is a hand-maintained subset and is imported only by api-client. The web app and mobile import neither.
  - Field drift found by comparing type bodies:
    - `ChildProfile` lacks 9 lib fields, including `deletedAt`, `canonicalImageUrl`, `imageDescription` and `musicEnabled`.
    - `Character` lacks 11 lib fields.
    - `StoryBookOutput` lacks 7 lib fields, including `finalization`, `artStatus`, `thumbnailUrl` and `actorExemplars`.
    - `Story` lacks 9 lib fields, including `pageGeneration`, `imageGeneration` and `status`.
    - `StorySession` has 6 `*At` fields that lib lacks, and lacks 10 lib fields, including `storyOutputTypeId` and `worldState`.
    - `StoryOutputType` has `pageCount`, `textDensity` and `needsImages`, which lib lacks.
  - The request/response DTOs (`StoryCompileResponse`, `Storybook*Request/Response`, `TTSRequest`, …) exist **only** in shared-types. The routes do not import them, so nothing checks the contract at compile time.

---

## 6. Terminology, largest components, delete candidates

### 6a. UI vs code glossary

| UI says | Code / Firestore | Notes |
|---|---|---|
| "Story" (My Stories) | `stories/{id}` (`Story`). Doc id == `storySessionId` | The `/stories` page lists `children/{id}/sessions` *sessions* and names its `stories` query result `storyBooks` (`stories/page.tsx:152`) |
| "Book", "My Books", "Storybook(s)" (parent) | `stories/{id}/storybooks/{sbId}` (`StoryBookOutput`) | Route param names: `[bookId]` = storybookId in `/storybook/[bookId]`, while `/kids/read/[bookId]` takes `storyId`+`storybookId` and `/storybook/[bookId]/print-layout` links back to `/story/${bookId}` (treating it as a storyId, `print-layout/page.tsx:270`) |
| (legacy book) | `stories/{id}/outputs/storybook/pages`, `story.pageGeneration`/`imageGeneration` | Still read by four pages |
| "What kind of book?", "Output Type", `childFacingLabel` | `storyOutputTypes` | |
| "Art style", "Picture style", "Image Style" | `imageStyles` | |
| "Way to make a story", generator tile | `storyGenerators` (`wizard`, `beat`, `friends`, `gemini3`, `gemini4`, `chat`), `storyMode`, `flowType`, `currentPhase` | The route folder `/story/[storyId]/[sessionId]` actually holds `generatorId` in its first segment (`story/[storyId]/[sessionId]/page.tsx:22-29`) |
| "Story type" | `storyTypes` (+ `storyPhases`, `promptConfigs`) | Used only by legacy and beat flows |
| "Characters", "Friends" | `characters` | Code also says `actors`, `entity`, `mainCharacterId` (children and characters together) |
| "Child", "profile" | `children` (`ChildProfile`) | Also `persona`, `activeChild`, kids "lock" |
| "Print layout", order | `printLayouts`, `printStoryBooks`, `printOrders`, `printProducts` | |
| "Session" (diagnostic only) | `storySessions` (+ `messages`, `events`) | |

### 6b. Largest client modules

| File | Lines | What it bundles |
|---|---|---|
| `src/app/story/session/[sessionId]/page.tsx` | 1,587 | The legacy "chat" generator end to end: warmup/AI warmup, beats, character creation and traits, endings, compile, the legacy `storyBook/pages`→`images` pipeline. More than 25 direct FS writes and 10 API routes |
| `src/components/story/story-browser.tsx` | 1,444 | The generic generator runtime. It loads generator, session, storyTypes, outputTypes and answerAnimations. It calls `generator.apiEndpoint`, persists messages and actors client-side, and handles friends proposal and character picker, character creation and avatars, ending selection, auto-compile, TTS, background music, `musicEnabled` writes and the diagnostics panel. It is hosted by 5 routes |
| `src/app/writer/page.tsx` | 1,074 | Writer CRUD for storyPhases, promptConfigs and storyOutputTypes, all direct FS |
| `src/app/storybook/[bookId]/page.tsx` | 944 | Parent book console: progress, retry, page edit, audio, finalize, share and print |
| `src/components/shared/EntityEditor.tsx` | 879 | Shared child/character form, photo upload, avatar generation, TTS name preview and image-description regeneration. Writes `children`/`characters` directly (`:297-508`) |
| `src/app/parent/children/page.tsx` | 865 | Child management, photos, avatars and animation, soft delete |
| `src/app/storybook/[bookId]/order/page.tsx` | 839 | Print order form |
| `src/app/kids/create/page.tsx` | 768 | PWA generator chooser, inline wizard Q&A, session creation, entitlement gate |

### 6c. Delete candidates (with evidence)

| Candidate | Evidence |
|---|---|
| `src/app/kids/play/[sessionId]/page.tsx` | No inbound link. `kids/create/page.tsx:302` routes to `/story/play` instead |
| `src/app/story/session/[sessionId]/select-output-type/page.tsx` | No inbound link (grep `select-output-type` finds nothing outside the file) |
| `src/app/story/wizard/[sessionId]`, `src/app/story/friends/[sessionId]` + `story/start/{wizard,friends}` | Superseded per the comment in `story/[storyId]/[sessionId]/page.tsx:17-19`. They survive only because static routes shadow the dynamic ones |
| `src/app/story/start/{gemini3,gemini4,chat}` | Copies of `/story/start/[generatorId]` that skip the sessions mirror. Shadow routes |
| Legacy single-book pipeline: `story/session/[sid]/{generating,compiled,select-image-style}`, legacy branches in `kids/create/[sid]/generating:155-230` and `story/session/[sid]:917,1034` | They `POST /api/storyBook/pages` and `/api/storyBook/images`. Those paths resolve to `api/storyBook/[bookId]/route.ts`, which exports only `GET` (`:7`), so these calls cannot succeed |
| Legacy `outputs/storybook/pages` read paths (`storybook/read:65`, `child/book/play:68`, `story/session/compiled:30`, `child/books` legacy branch) | Writer side gone (see above). Depends on data migration |
| `hooks/use-feature-flag.ts` | No consumers |
| `api-client` `createSession` / `getStorybookStatus` stubs | They throw 501 |
| `/parent/diagnostics` link (`parent/page.tsx:79`) | Target page does not exist |
| `src/app/logout/page.tsx` | No inbound links (header signs out in place, `header.tsx:96`) |
| `/firestore-test` | Dev-only rules harness that writes test docs to production collections. Better as an emulator test |
| `MobileApiClient` (as code) | Duplicates `@storypic/api-client`, has drifted, and contains a payload bug |

---

## Observations for the redesign

- The "server-first" rule is followed only by mobile and by half of the kids PWA. The main web child flow (`/child`, `/story`) and the parent console are Firestore-SDK-first. This includes all *writes* that create sessions and storybooks, the transcript persistence, and the soft deletes. Removing client writes is a prerequisite for tightening Firestore rules.
- There are three child-selection models (`activeChildId`, the kids PWA lock, the mobile selection) and three PIN UIs. A single server-side persona (the cookie already exists) would let them collapse.
- There are three families of route trees for the same journey (`/child`+`/story`, `/kids`, mobile). The kids PWA is not self-contained, because it hands off to `/story/play` for most generators.
- The contract layer is unused: `shared-types` is not imported by routes, web or mobile, and it has drifted from `src/lib/types.ts`.
- The legacy "chat" session page and the `outputs/storybook` model account for roughly 3,000 lines of client code that call endpoints which no longer exist.
