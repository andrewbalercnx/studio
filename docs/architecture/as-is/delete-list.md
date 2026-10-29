# Delete List (as-is)

> Phase 1 of `../REVIEW_PLAN.md`. Code and data with no live caller, or superseded, with the
> evidence for each. Phase 2 confirms the list; deletion happens in the Phase 5 slices (or
> earlier where it is pure dead code). Citations are in the area maps under `areas/`.
> Items marked **Done (5.2)** were deleted in slice 5.2 (`target/slices/5.2-book-clients.md`).

## Creation

| Item | Evidence |
|------|----------|
| ~~`start-story-flow.ts`, `story-chat-flow.ts`, `story-synopsis-flow.ts`~~ **Done (5.4)** | No importers |
| ~~Kids-flows stack: `/api/kids-flows`, `systemConfig/kidsFlows`, `/admin/kids-flows`, its loader~~ **Done (5.4)** (with `/api/kids-generators`, replaced by `GET /api/creation-modes`) | No caller; superseded by `storyGenerators.enabledForKids` |
| ~~`/story/session/[sid]/select-output-type`, `/kids/play/[sid]`~~ **Done (5.4)** | No inbound links |
| ~~Static start pages `/story/start/{wizard,friends,gemini3,gemini4,chat}` and `/story/{wizard,friends}/[sid]`~~ **Done (5.4)**, with `/story/start`, `/story/start/[generatorId]`, `/story/[generatorId]/[sid]`, `/story/play/[sid]` and `StoryBrowser` | Duplicate the dynamic `[generatorId]` routes; reachable only because static routes take precedence (and they skip its `live` check) |
| ~~Arc engine: `/api/storyArc`, `story-arc-flow.ts`, `/admin/storyArcTest`~~ **Done (5.4)** | Admin test only |
| ~~Legacy warmup engine: `/story/session/[sid]`, `/story/type/[sid]`, `/api/warmupReply`, `/api/ai-warmup`~~ **Done (5.4)** | Diagnostic only; its beat handling no longer matches `/api/storyBeat` |
| ~~`/api/gemini4` `createCharacter` branch, `gemini4CreateCharacterFlow` alias~~ **Done (5.4)**: every mode route and flow (`storyWizard`, `gemini3`, `gemini4`, `storyFriends`, `storyBeat`, `storyEnding`, `storyCompile`, `storySession`, `characterTraits`, `characters/create`, and the wizard, gemini3/4, friends, beat, ending, compile, text-compile, title, synopsis, character, traits and warmup flows) is deleted; the engines in `src/server/creation` replace them | No browser code sends that action |
| `storyPhases` collection, `storyPhaseId` / `endingPhaseId` / `defaultPhaseId` fields, writer tab | Written, never read |

## Storybook

| Item | Evidence |
|------|----------|
| ~~Calls to `/api/storyBook/pages` and `/api/storyBook/images` (legacy session pages, kids generating page legacy branch)~~ **Done (5.2)**: the session generating/compiled/select-image-style pages, the kids generating page and the session page's calls are deleted | Route files do not exist; requests hit the GET-only `[bookId]` route and fail |
| ~~`/api/storybookV2/{create,pages,images,finalize,pageEdit}`, `story-page-flow`, `story-pagination-flow` (+ `/api/storyPagination`, `/admin/paginationTest`), `story-image-flow`, `story-exemplar-generation-flow`, `story-page-audio-flow` (+ `/api/storyBook/pageAudio`), the client "pages then images" orchestration, the page editor~~ **Done (5.2)** | Replaced by the Book pipeline (`src/server/books`, `/api/books`) |
| ~~Old storybook read paths: `/storybook/[id]` and `/read`, "Earlier storybooks" sections, `/api/parent/storybooks[/thumbnails]`, `/api/stories/[id]/storybooks[/[sb]/pages]`, `/api/storyBook/{audio,actorAvatar}`, `story-audio-flow`, `story-actor-avatar-flow`, `book-reader/{BookReader,ParentBookView,BookPageSpread}`~~ **Done (5.4)**; the print/order/share paths stay for the print slice | Trial data reset |
| `outputs/storybook` fallbacks in image, audio and order code; `LegacyStoryWithOutput`, `StoryBook` alias, `StoryBookFinalizedPage`, `isFinalized`, `actorExemplars` | Nothing live writes `outputs/storybook` |
| Top-level `storyBooks` collection | Only the help-sample seed and the rules test page touch it |
| `actor-exemplar-flow.ts`, `exemplars` collection, `ActorExemplar` type, its `SCHEMA.md` section | Last caller deleted (Phase 0 removed the orphan route) |
| `_debug` payload and "printStoryBookId might be a storybookId" fallback in `/api/storyBook/[bookId]` | Defensive code for a past mix-up |
| Unused status values (see `status-audit.md`) | Never written |

## Characters

| Item | Evidence |
|------|----------|
| `canonical-image-flow.ts` and its fields and regression checks — **or wire it into the exemplar flow** | Generated on every upload, read by nothing live. CLAUDE.md describes a canonical → exemplar pipeline that does not run |
| `StorySession.mainCharacterId`, `Story.metadata.characterIds` (the regression scenarios that wrote them are deleted in 5.4; the types remain in `src/lib/types.ts`) | Only the regression test writes `mainCharacterId` |
| `characters.traits` writes and ~~the traits Q&A flow~~ (**flow and route deleted, 5.4**) | Write-only data |
| `PreferenceInput` component; `ManagePhotos` and `AvatarGenerator` (duplicating `EntityEditor`) | Unused / duplicate UI |
| Five or more copies of the placeholder-extraction regex (the client resolvers `use-resolve-placeholders` and `lib/resolve-placeholders.ts` are gone in 5.4; `[[cast:id]]` has one module, `src/server/creation/tokens.ts`) | Duplication |

## Print and orders

| Item | Evidence |
|------|----------|
| `POST /api/printOrders` (legacy) | Only the regression page creates orders this way |
| `/api/printOrders/[orderId]/pay` stub ("Mark as Paid (test)") | Not real payment |
| `GET /api/user/shipping-address`, `users.savedShippingAddress` | Superseded by `users/{uid}/addresses` |
| `lib/mixam/pdf-validator.ts`, `mixamClient.uploadFile` / `getPriceQuote`, `getActivePrintProducts` / `getPrintProduct` | No callers |
| `PrintLayout.textBoxes` / `imageBoxes` | Deprecated |
| Never-written fields: `combinedPdfUrl`, `mixamCost`, `mixamFileReferences`, `validationResult`, `notificationAdminUid`, `blankPages` | Never written |
| One of the two PDF generators (`printStoryBooks/.../generate-pdfs` or `storyBook/printable`) | Once Phase 2 picks one print-edition model |

## Config and admin

| Item | Evidence |
|------|----------|
| Unused text-model getters and `MODEL_USAGE_MAP` — **or wire them up** | Text flows hard-code their models; `/admin/ai-models` text settings have no effect |
| `src/lib/migrations/*`, `src/lib/migration/*` | No importers |
| `/admin/tasks` | Calls a route that does not exist |
| `/admin/storyDesigner`, `/admin/voiceTest`, `/admin/characters`, `/admin/children` | Not linked |
| `/api/admin/audit-collections` | No UI caller |
| `useFeatureFlag` hook | Used only by the regression page |
| `/api/imageStyles/seed` | Creates duplicate styles on every run |

## Clients

| Item | Evidence |
|------|----------|
| `/logout` page, `/parent/diagnostics` link | No links / target page missing |
| `/firestore-test` | Writes test documents into production collections |
| ~~`packages/api-client` 501 stubs (`createSession`, `getStorybookStatus` — done (5.2), with `createStorybook` / `generatePages` / `generateImages`)~~ **Done (5.4)**: the client has `createStory` / `sendTurn` / `abandonStory` / `retryFinish` / `listCreationModes` | `/api/storySession` exists |
| Mobile's hand-copied `MobileApiClient` | Copy of `packages/api-client`; brought in line with the creation routes in 5.4, still a copy (Phase 6) |
| ~~`src/contexts/api-client-context.tsx` (the kids PWA's api-client provider)~~ **Done (5.4)** | The kids pages use the shared creation components and `src/lib/stories/api.ts` |
