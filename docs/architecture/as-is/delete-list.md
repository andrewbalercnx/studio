# Delete List (as-is)

> Phase 1 of `../REVIEW_PLAN.md`. Code and data with no live caller, or superseded, with the
> evidence for each. Phase 2 confirms the list; deletion happens in the Phase 5 slices (or
> earlier where it is pure dead code). Citations are in the area maps under `areas/`.

## Creation

| Item | Evidence |
|------|----------|
| `start-story-flow.ts`, `story-chat-flow.ts`, `story-synopsis-flow.ts` | No importers |
| Kids-flows stack: `/api/kids-flows`, `systemConfig/kidsFlows`, `/admin/kids-flows`, its loader | No caller; superseded by `storyGenerators.enabledForKids` |
| `/story/session/[sid]/select-output-type`, `/kids/play/[sid]` | No inbound links |
| Static start pages `/story/start/{wizard,friends,gemini3,gemini4,chat}` and `/story/{wizard,friends}/[sid]` | Duplicate the dynamic `[generatorId]` routes; reachable only because static routes take precedence (and they skip its `live` check) |
| Arc engine: `/api/storyArc`, `story-arc-flow.ts`, `/admin/storyArcTest` | Admin test only |
| Legacy warmup engine: `/story/session/[sid]`, `/story/type/[sid]`, `/api/warmupReply`, `/api/ai-warmup` | Diagnostic only; its beat handling no longer matches `/api/storyBeat` |
| `/api/gemini4` `createCharacter` branch, `gemini4CreateCharacterFlow` alias | No browser code sends that action |
| `storyPhases` collection, `storyPhaseId` / `endingPhaseId` / `defaultPhaseId` fields, writer tab | Written, never read |

## Storybook

| Item | Evidence |
|------|----------|
| Calls to `/api/storyBook/pages` and `/api/storyBook/images` (legacy session pages, kids generating page legacy branch) | Route files do not exist; requests hit the GET-only `[bookId]` route and fail |
| `outputs/storybook` fallbacks in image, audio and order code; `LegacyStoryWithOutput`, `StoryBook` alias, `StoryBookFinalizedPage`, `isFinalized`, `actorExemplars` | Nothing live writes `outputs/storybook` |
| Top-level `storyBooks` collection | Only the help-sample seed and the rules test page touch it |
| `actor-exemplar-flow.ts`, `exemplars` collection, `ActorExemplar` type, its `SCHEMA.md` section | Last caller deleted (Phase 0 removed the orphan route) |
| `_debug` payload and "printStoryBookId might be a storybookId" fallback in `/api/storyBook/[bookId]` | Defensive code for a past mix-up |
| Unused status values (see `status-audit.md`) | Never written |

## Characters

| Item | Evidence |
|------|----------|
| `canonical-image-flow.ts` and its fields and regression checks — **or wire it into the exemplar flow** | Generated on every upload, read by nothing live. CLAUDE.md describes a canonical → exemplar pipeline that does not run |
| `StorySession.mainCharacterId`, `Story.metadata.characterIds` | Only the regression test writes `mainCharacterId` |
| `characters.traits` writes and the traits Q&A flow | Write-only data |
| `PreferenceInput` component; `ManagePhotos` and `AvatarGenerator` (duplicating `EntityEditor`) | Unused / duplicate UI |
| Five or more copies of the placeholder-extraction regex | Duplication |

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
| `packages/api-client` 501 stubs (`createSession`, `getStorybookStatus`) | `/api/storySession` exists |
| Mobile's hand-copied `MobileApiClient` | Drifted copy of `packages/api-client` |
