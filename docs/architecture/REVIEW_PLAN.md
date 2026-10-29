# Architecture Review & Rebuild Plan

> **Created**: 2026-10-28 · **Status**: Phase 2 decided; Phases 3 and 4 next
>
> The codebase was started in an early Firebase Studio and grew one feature at a time. This plan
> reviews it end to end and rebuilds the parts that lack a coherent model, above all the process of
> turning a conversation with a child into a story, a storybook and a printed book.

---

## Constraints (agreed 2026-10-28)

| Question | Answer | Consequence |
|----------|--------|-------------|
| Work on branches with PRs instead of pushing to main? | Yes | One branch and PR per phase or slice. CI is the merge gate. See `CLAUDE.md` → Git Workflow. |
| Must existing user data survive? | No, everything is in trial | No data migrations. Trial user data (children, sessions, stories, storybooks, orders) can be wiped when a slice ships. |
| Must installed mobile builds keep working? | No | API shapes can change freely; the mobile app is updated alongside. |

So this is a **rebuild-and-delete** plan, not a strangler migration. Each slice is rebuilt against
the target model, the old code is deleted in the same PR, and trial data is reset.

One thing is **not** throw-away: admin-curated configuration. Prompts, story types, story
generators, image styles, print products and layouts, Mixam mappings, AI model settings, voices and
answer animations are product work, not test data. Export them before any reset (Phase 1) and
re-seed them into the new schema.

---

## Starting evidence (first pass, 2026-10-28)

- **Unauthenticated routes.** Some story, AI and storybook routes run with the Admin SDK and never
  check the caller, e.g. `/api/storyBeat`, `/api/gemini3`, `/api/gemini4` and
  `GET /api/storyBook/[bookId]`. A rough grep flags 34 of 127 route files with no recognisable auth
  check. Admin SDK access ignores `firestore.rules`, so the rules protect nothing on those paths.
- **One concept, many names.** `StoryBook` is a type alias for `LegacyStoryWithOutput`;
  `StoryBookPage` aliases `StoryOutputPage`. "Storybook" appears as `StoryBook`, `StoryOutput`,
  the `storybooks` subcollection, the legacy `storyBooks` collection and `printStoryBooks`.
  `/api/storyBook/*` and `/api/storybookV2/*` coexist.
- **Seven or more story-creation modes** (session warmup/beat/ending/compile, `storyWizard`,
  `gemini3`, `gemini4`, friends, `kids-generators`, `storyGenerators` config) with nothing that
  says they are variants of one process.
- **No status vocabulary.** 40+ `status` fields, mixing `idle|pending|generating|ready|error`,
  `idle|running|ready|error|rate_limited`, `draft|finalized|printable_ready|ordered` and `string`.
- **Two auth helper modules** (`src/lib/auth-utils.ts`, `src/lib/server-auth.ts`) and about ten
  separate `*-config.server.ts` loaders.
- **Size.** About 120k lines across 520 TS/TSX files. `src/lib/types.ts` is 2,649 lines. 33 unit
  test files.
- **Earlier plans exist** and are absorbed into Phase 2 rather than run in parallel:
  `docs/REFACTORING-TODOS.md` (entity references and scene/world state),
  `docs/SCHEMA_CLEANUP_PLAN.md`, `docs/SECURITY_REMEDIATION.md`.

---

## Phases

### Phase 0 — Stop the bleeding

Small fixes on the code as it stands. No restructuring.

- Require an authenticated caller and an ownership check on every route that reads or writes user
  data or calls an AI model. Web clients that call these routes with bare `fetch` must send the
  Firebase ID token.
- Produce the route auth matrix (`docs/architecture/route-auth-matrix.md`): route, required role,
  ownership rule.
- Finish the outstanding items in `docs/SECURITY_REMEDIATION.md` and add a secret scan (`gitleaks`)
  to CI.
- CI gates on every PR: typecheck, lint, unit tests.
- A behavioural end-to-end test in `TEST_MODE`: create a child → run a story session → compile →
  generate a storybook → produce print PDFs. It asserts outcomes (a story exists with text, the
  storybook has N pages with images and audio, the PDFs exist), **not** Firestore document shapes,
  because those shapes will change.

**Exit**: no unauthenticated route touches user data or AI models; CI runs on PRs; the end-to-end
test passes.

### Phase 1 — Map the system as it is (read only)

Outputs in `docs/architecture/as-is/`:

- **Glossary**: every domain term with its synonyms in code.
- **Creation-mode catalogue**: each way a story is made, with the routes, flows and collections it
  touches, and whether it is live, experimental or dead.
- **Collection ownership table**: for each collection, the writers and readers (route, flow, client)
  and whether access is Admin SDK or client rules.
- **Status audit**: each status field, the code that sets each value, and the transitions observed.
- **Config export**: a script that dumps the curated config collections to JSON, committed under
  `seed/`, so the reset in Phase 5 loses nothing of value.
- **Delete list**: code with no callers, experiments to retire, legacy-only collections.

This phase is read-only and splits cleanly by area (creation modes, storybook pipeline,
characters/actors, print, config, clients), so it can run as parallel agents.

**Exit**: the owner confirms the glossary and catalogue match the product as they know it.

### Phase 2 — Target domain model (owner sign-off required)

The phase that matters most. Outputs in `docs/architecture/`:

- **Entities with one name each**, used in types, collections, routes and UI. Starting proposal:
  Child, Character (actors), StorySession (co-creation), Story (finished text), Storybook (a
  rendered edition: pages, art, audio), PrintEdition, PrintOrder.
- **Storybook pipeline as explicit steps**: paginate → annotate scenes → exemplars → page images →
  audio → finalize → print PDFs. Each step is idempotent and retryable and records progress in one
  shared job-state shape with one status vocabulary.
- **Creation modes as one interface** with several implementations, all producing the same Story for
  the same downstream pipeline. This phase decides which modes survive.
- **World state and scenes** from `REFACTORING-TODOS.md` folded into the Story/Storybook model, not
  bolted on afterwards.
- **ADRs** in `docs/architecture/adr/` for each decision, with rationale.
- `SCHEMA.md` and `SYSTEM_DESIGN.md` rewritten to describe the target.

**Exit**: owner sign-off on entities, state machines and the delete list.

### Phase 3 — Security review in depth

Runs alongside Phase 2; it needs the collection ownership table, not the new model.

- One route wrapper (e.g. `withAuth({ role, owns })`) replacing both auth helper modules, enforced
  by a lint rule.
- Decide whether any client touches Firestore directly (the `/kids/*` PWA does today); tighten
  `firestore.rules` and `storage.rules` to match the decision.
- Child persona and PIN model, share tokens, Mixam webhook signature verification.
- Children's photos and personal data: who can read originals, signed URL lifetimes, deletion on
  account close, GDPR-K/COPPA retention.
- AI cost abuse: per-user rate limits; entitlement check before any model call.

**Exit**: threat model written; all high findings fixed.

### Phase 4 — Foundations

The skeleton the rebuilt slices live in.

- Layers: thin route handlers (parse → call service → respond); domain services hold logic;
  repositories are the only Firestore access and validate with zod on read.
- `types.ts` split per entity; `packages/shared-types` generated from the same zod schemas.
- One typed config service replacing the `*-config.server.ts` loaders.
- One AI flow harness: retries, circuit breaker, tracing and model resolution in one place.

**Exit**: foundations merged with at least one small slice (e.g. Characters) on them, as a proof.

### Phase 5 — Rebuild slice by slice

Each slice: build on the foundations against the Phase 2 model, delete the old code in the same PR,
reset trial data for that slice, re-seed config. Order:

1. **Storybook generation**: the most complex and least consistent part (`story-image-flow.ts`
   1,878 lines, `storyBook/printable/route.ts` 1,289 lines). Replaces both `storyBook` and
   `storybookV2` APIs.
2. **Story creation modes** behind the shared interface; retired modes deleted.
3. **Characters and actors**, keeping the original-photo rule in `CLAUDE.md`.
4. **Print and orders**.

**Exit per slice**: old code deleted, end-to-end test green, docs updated.

### Phase 6 — Clients

- Break up the largest pages (story session 1,586 lines, admin story types 1,790, story browser
  1,443).
- `/kids/*` PWA moves onto the API.
- Web, PWA and mobile all use `packages/api-client`.

### Phase 7 — Governance

- Lint rules: no Firestore imports outside repositories; no route without the auth wrapper.
- Archive the stale plan documents at the repo root; start a fresh `CHANGES.md` after the rebuild.
- `CLAUDE.md` points to the glossary and domain model as required reading.

---

## Progress

| Phase | Status | PR |
|-------|--------|----|
| 0 — Stop the bleeding | Done (follow-up fixes in a second PR) | #7 |
| 1 — As-is map | Done; owner chose the surviving creation modes | #8 |
| 2 — Target model | Done: `target/`, 12 ADRs accepted | #10 |
| 3 — Security review | Not started | — |
| 4 — Foundations | In review: `src/server` (route wrapper, repositories, job runner, AI harness, config service), see `target/foundations.md` | #12 |
| 5 — Rebuild slices | Not started | — |
| 6 — Clients | Not started | — |
| 7 — Governance | Not started | — |
