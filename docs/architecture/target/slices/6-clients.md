# Phase 6 — Clients

> **Created**: 2026-11-05 · Phase 6 of `../../REVIEW_PLAN.md`. Plan only; built in four PRs (below).

Phase 5 put every product flow on the server. Phase 6 finishes the clients:
- one API client for web, kids PWA and mobile;
- no page reads the old children and characters field names, so the server can stop copying likeness
  writes into them and the fields can go;
- the six pages over 1,000 lines are split up.

ADR-0005 still holds: the browser writes user data only through the API and may read its own documents
live.

## Owner decisions (2026-11-05)

| Question | Decision |
|----------|----------|
| One API client | **One package.** The web's `src/lib/{books,orders,people,stories}/api.ts` calls move into `packages/api-client`; web, kids PWA and mobile call the same functions with the same types. The web modules become thin wrappers that pass the signed-in user's token, then go |
| The old likeness and owner fields | **Removed in Phase 6.** Every reader moves onto `likeness.*` and `ownerUid`, the server stops mirroring, and a script removes `avatarUrl`, `avatarAnimationUrl`, `imageDescription`, `canonicalImageUrl`, their `*Generation` blocks, the top-level `photos` and `ownerParentUid`. Needs a new APK |
| Pages over 1,000 lines | **Split, same behaviour.** Each becomes components and hooks with no visible change; where these pages still write config from the browser, the writes move to admin routes |
| Live reads | **Kept for Books and Stories** (listeners show progress as it happens). Children and characters are read through the API views (`PersonView`), never from Firestore |

## What exists today

From a survey of `main` at `c81c24d` (after #44).

| Area | Today |
|------|-------|
| API clients | `packages/api-client` (`StoryPicClient`, 290 lines): stories, books, output types, image styles, TTS; used only by mobile (`mobile/src/contexts/ApiClientContext.tsx`). The web has its own four modules (564 lines) with their own error classes and copies of the view types |
| Children and characters reads | 32 files read `avatarUrl` and 26 read `ownerParentUid` outside `src/server`, among them: the home page and the parent dashboard (children by `ownerParentUid` from Firestore), `use-app-context` (the active child), `kids/layout` and `kids/setup`, `parent/storybooks/[childId]`, `view-as-parent`, `use-resolve-placeholders`, four creation components, and ten API routes and `src/lib` server helpers (`route-auth.server.ts`, persona, onboarding, entitlements, voices, feedback, admin cleanup, audit and help samples, system test) |
| Mobile | Reads `avatarUrl` from `GET /api/children` (home, child picker, story and play screens) |
| Server mirror | `entities.ts` `MIRROR_LEGACY = true`: likeness writes also go to the old fields; reads fall back to them; `listPeople` and the rules match either owner field |
| Pages over 1,000 lines | `admin/storyTypes` 1,790 (writes `storyTypes`), `admin/regression` 1,388 (seeds test data as admin), `admin/print-layouts` 1,102 (writes `printLayouts`, `printProducts`), `writer` 1,074 (writes `storyPhases`, `promptConfigs`, `storyOutputTypes`), `admin/print-products` 1,071 (writes `printProducts`), `admin/storyGenerators` 1,011 (writes `storyGenerators`) |
| Browser writes left | Only to the user's own `users/{uid}` profile (signup defaults, startup wizard flag; the rules limit the fields), admin-only config and admin test data. No user-data writes |

## Slices

### 6.1 One API client

- `packages/api-client` gains the calls the web modules make today:
  - books: create, get, retry page, lock, unlock, print options, renders;
  - orders: create, list, get, checkout, pay with credits, cancel, and the admin order calls;
  - people: list, get, create, update, delete, restore, photos, avatar, refresh, owner change;
  - stories: the calls mobile already has.
- **One error type** (`StoryPicApiError`, carrying `code`, `status` and the user-safe message) and one
  envelope reader for `{ ok, data | error }`.
- **Auth**: the client takes a token provider; the web passes the Firebase user's ID token, mobile its
  own. The persona cookie still travels for same-origin web calls.
- **Types**: the view types (`PersonView`, `OrderView`, `BookReadView`, …) live once in
  `packages/shared-types`, hand-written as today. Generating them from the zod schemas stays in Phase 7.
- `src/lib/*/api.ts` become thin re-exports, and the pages import from `@storypic/api-client`.
- **Tests**: unit tests per call against a fake `fetch`. The blocking E2E (funnel, order, characters)
  stays green.

### 6.2 Children and characters through the API (web and kids PWA)

- Every web and PWA reader of children or characters uses `peopleApi` and `use-people` (or one
  `useActiveChild` hook built on them):
  - the home "Who is playing?" screen and the parent dashboard;
  - `use-app-context`;
  - `kids/layout` and `kids/setup`;
  - `parent/storybooks/[childId]`;
  - `view-as-parent` (admin views through the admin routes);
  - the creation components that show avatars.
- `avatarUrl` reads become `likeness.avatar`, and owner checks become `ownerUid`.
- **Server**: the API routes and `src/lib` helpers that read `children.ownerParentUid` (persona,
  onboarding, entitlements, voices, feedback, `route-auth.server.ts`, the admin tools) read through
  `characters/entities.ts` (`ownerOf`, `readPerson`).
- **Kids PWA**: after this slice it has no Firestore import except the Book and Story live hooks.
- **Placeholders**: `use-resolve-placeholders` resolves `$$id$$` names through the server (it already
  has `resolve-placeholders.server.ts`) instead of reading children and characters itself.
- **Tests**: E2E for kids setup → kids home showing the avatar; the funnel and characters specs stay
  blocking.

### 6.3 Mobile and the old fields go

**Before this slice**: the owner confirms the `migrate-likeness` run (`DEPLOYMENT.md` §12) has been done
in production.

- **Mobile** reads `likeness.avatar` and `likeness.avatarAnimation` from the API, which already returns
  them. A new APK goes out (CLAUDE.md "Mobile App (APK) Updates").
- **Server**:
  - `MIRROR_LEGACY = false`; the old-field fallbacks leave `entities.ts`;
  - `listPeople` and the rules match `ownerUid` only;
  - `GET /api/children` keeps its bare shape without the old fields.
- **Data**: `scripts/drop-legacy-likeness.mjs` removes the old fields from `children` and `characters`.
  It is a dry run by default, refuses documents not yet migrated, and needs `--confirm --project`.
  `ChildProfile` and `Character` in `src/lib/types.ts` lose the old fields.
- **Order at deploy**:
  1. The APK is published.
  2. The app deploys.
  3. The rules deploy.
  4. The drop script runs.

  An older APK still installed shows the initial-letter tile instead of the avatar until it is updated.
- **Tests**: rules tests for `ownerUid`-only reads; unit tests for the drop script (idempotent, skips
  unmigrated documents); E2E unchanged.

### 6.4 Split the pages over 1,000 lines

For each of the six pages:
- a folder under `src/components/admin/<page>/` (or `src/components/writer/`);
- the list, the form and the dialogs as components, and a data hook;
- the page file only composes them.

No change a user can see.

- **Config writes** in these pages move to admin routes on `withRoute` (`auth: 'admin'`, or
  `'writer'` for the writer page), with zod bodies:
  - story types;
  - print layouts and products;
  - story phases, prompt configs and output types;
  - story generators.

  The rules then refuse browser writes to those collections (admin writes from the Admin SDK only).
- **`admin/regression`** keeps its scenarios, split per area. Its admin test-data writes stay
  browser-side: the page is a diagnostic tool, and the rules keep admin writes allowed for it.
- **Tests**:
  - route unit tests for each config route;
  - rules tests for the refused writes;
  - a smoke E2E that opens each split page as an admin and saves one item.

## Not in Phase 6

- Generating `shared-types` from the zod schemas, the remaining routes not on `withRoute`, the
  `*-config.server.ts` loaders and the `types.ts` split: Phase 7.
- Lint rules (no Firestore import outside repositories and the read hooks; no route without the
  wrapper): Phase 7.
- Pages between 500 and 1,000 lines: split only when a slice touches them.
- New features on any client.
