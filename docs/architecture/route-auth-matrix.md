# Route Auth Matrix

> **Last Updated**: 2026-10-29 (Phase 5.4: creation and read routes on `withRoute`; the old story-flow routes are deleted — their Phase 0 rows below are history). 2026-10-28 (Phase 0 of `REVIEW_PLAN.md`)
>
> Every API route runs on the Firebase Admin SDK, which ignores `firestore.rules`. The route itself
> is the only access control, so each one must check **who** is calling (authentication) and
> **whether they own** what they touch (ownership). This table records the rule per route.
> Phase 3 replaces the mix of helpers below with a single route wrapper enforced by lint.

## How the checks work

| Mechanism | Where | What it proves |
|-----------|-------|----------------|
| Bearer ID token | `requireAuthenticatedUser` (`src/lib/server-auth.ts`), `verifyAuthToken` (`src/lib/auth-utils.ts`) | Caller is a signed-in Firebase user |
| Parent role | `requireParentOrAdminUser` | Token claim, or `users/{uid}.roles.isParent` (self-assignable, so effectively "signed-in user") |
| Admin | `requireAdminUser` | `isAdmin` token claim |
| Ownership guards | `src/lib/route-auth.server.ts` | Token uid equals the doc's owner field. A missing owner field is **not** owned. Admin and writer principals are exempt. Also applies the persona scope |
| Child persona | `enforcePersonaScope` (`src/lib/persona.server.ts`) | Narrows a parent's access to one child when the persona cookie is present. **Not authentication**: it allows a request without the cookie |
| Signature | Mixam webhook | Request came from Mixam |
| Internal secret | `isInternalSecretValid` | Caller holds `INTERNAL_API_SECRET` |
| Route wrapper (Phase 4) | `withRoute` (`src/server/http/with-route.ts`) | One declared mode per route: `public`, `user` (ID token, header only), `admin` (`isAdmin` claim), `internal` (Cloud Tasks OIDC token for `JOBS_INVOKER_SERVICE_ACCOUNT`). Ownership via `loadOwned` / `assertOwner` on `ownerUid` |

Owner fields: `stories.ownerUid` (and `turns`, `books`, `manuscripts`, `jobs`: `ownerUid`),
`children.ownerParentUid`, `characters.ownerParentUid`, `printStoryBooks.ownerUserId`,
`printOrders.parentUid` (legacy: `ownerUserId`). `storySessions` and legacy `stories.parentUid`
are gone with slice 5.4.

Web clients call protected routes through `authFetch` (`src/lib/auth-fetch.ts`), which adds the ID
token only for same-origin `/api/` URLs. The mobile app and `packages/api-client` send it on every
request.

## Routes changed in Phase 0

These routes were open, or authenticated without checking ownership, before Phase 0.

| Route | Before | Now |
|-------|--------|-----|
| `POST /api/storyBeat`, `warmupReply`, `storyEnding`, `gemini3`, `gemini4`, `storyArc` | No auth: anyone with a session ID could run billed AI calls and read/write the session | Token + owns session |
| `POST /api/storyCompile` | Persona only (passes without the cookie), and consumed the session owner's story allowance | Token + owns session |
| `POST /api/characters/create`, gemini4 `createCharacter` | No auth; `parentUid`/`childId` taken from the body, so characters could be planted in any family | Token + owns session; owner and child come from the session |
| `POST /api/characterTraits` | No auth | Token + owns session + owns character |
| `POST /api/storyPagination` | No auth; billed AI call; writes `stories.locationRegistry` | Token + owns story |
| `GET /api/storyBook/[bookId]` | No auth; returned the whole story doc and any print storybook by ID | Token + owns story (help-tour `help-*` samples readable by any signed-in user, as in `firestore.rules`); a print storybook is returned only if it belongs to that story |
| `POST /api/printStoryBooks/[id]/generate-pdfs` | No auth; returned tokenised PDF download URLs | Token + owns print storybook |
| `POST /api/printStoryBooks/[id]/auto-layout` | No auth; overwrote `pages` | Token + owns print storybook + owns its story |
| `POST /api/generateAvatar`, `generateAvatar/animation`, `generateCharacterAvatar` | Parent role only: any parent could bill or overwrite another family's avatars | + owns child / character |
| `POST /api/storyBook/audio`, `pageAudio`, `actorAvatar` | Parent role only | + owns story |
| `storybookV2/pages`, `images`, `finalize`, `pageEdit`; `storyBook/share`, `storyBook/printable`; `printOrders` POST, `printOrders/[orderId]/pay` | Ownership skipped when the owner field was missing | Strict: a missing owner field is denied |
| `GET /api/postcode/lookup` | No auth; each call billed the getAddress.io key (up to 11 upstream calls) | Any signed-in user |
| `POST /api/ai-warmup` | No auth; billed model call | Any signed-in user |
| `POST /api/webhooks/mixam` | Accepted unsigned requests; skipped verification with no secret | Signature required; 503 if the secret is unset |
| `GET /api/healthz` | Returned the last 10 server log lines to anyone (`ENABLE_DEV_LOGS=true` in production) | Logs only for an admin token; status stays public |
| `POST /api/storybookV2/exemplars` | No auth (persona only); no callers | Deleted |

## Phase 0 follow-up (2026-10-29)

| Surface | Before | Now |
|---------|--------|-----|
| `storyWizardFlow` called from `/kids/create` | The flow was imported into a client component, which made it a public server action: no auth, any session ID | Page calls `runKidsWizardStep` (`src/app/kids/create/actions.ts`): ID token + owns session + child matches + persona scope |
| Placeholder name fallback (`resolveEntitiesInText`, story image flow) | Unresolved `$$Name$$` placeholders were looked up by `displayName` across **all** families, so another family's child photos or character details could reach prompts | Lookup limited to the story owner's entities (`ownerParentUid`); skipped when the owner is unknown |
| `logAIFlow` imported by `/admin/characters` | An unused import of a `'use server'` module, which can expose it as a public server action (anyone could write `aiFlowLogs` entries) | Import removed; no client component imports a `'use server'` module any more |
| `printOrders` (Firestore rules) | Owner could create, update and delete orders directly, including status, payment and PDF URLs that the admin submit route trusts | Admin only; server routes write orders |
| `printStoryBooks` (Firestore rules) | Owner could set `pdfStatus` and PDF URLs | Owner creates drafts only (no PDF fields); updates admin/server only |

## Phase 4 (2026-10-29)

| Route | Rule |
|-------|------|
| `POST /api/internal/jobs/run` | `withRoute({ auth: 'internal' })`: Cloud Tasks OIDC token, audience `JOBS_OIDC_AUDIENCE` (default `JOBS_RUN_URL`), email `JOBS_INVOKER_SERVICE_ACCOUNT`. User tokens and the internal secret are rejected; unset config rejects everything |

## Phase 5.1 (2026-10-29)

| Route | Rule |
|-------|------|
| `POST /api/manuscripts` | `withRoute({ auth: 'user' })`; story owner (`stories.parentUid`) via `assertOwner`, persona scope with the story's `childId` |
| `POST /api/books` | As above for `storyId`; `loadOwned(manuscripts)` for `manuscriptId`. Charges the story owner's `storybook_allowance` in the creating transaction |
| `POST /api/books/[bookId]/pages/[pageNumber]/retry` | `loadOwned(books)` (`ownerUid`, persona scope with the Book's `childId`) |
| `POST /api/books/[bookId]/lock`, `/unlock` | `loadOwned(books)` |

## Phase 5.3 and 5.4 (2026-10-29)

| Route | Rule |
|-------|------|
| `POST /api/stories` | `withRoute({ auth: 'user' })`; the child must be the caller's (`children.ownerParentUid` via `assertOwner`, persona scope with the child); mode live (and `enabledForKids` under a child persona); `story_allowance` checked (402) |
| `POST /api/stories/[storyId]/turns`, `/abandon`, `/finish` | `withRoute({ auth: 'user' })`; target Story owner (`ownerUid`, persona scope with the Story's `childId`); a non-Story document is 404 |
| `GET /api/stories?childId=` | `withRoute({ auth: 'user' })`; the child must be the caller's (persona scope applies) |
| `GET /api/stories/[storyId]` | `withRoute({ auth: 'user' })`; Story owner (persona scope applies) |
| `GET /api/creation-modes` | `withRoute({ auth: 'user' })`; config read (kid-safe presentation, no prompts) |

Deleted in 5.4: `storyWizard`, `gemini3`, `gemini4`, `storyFriends`, `storyBeat`, `storyEnding`,
`storyCompile`, `storySession`, `warmupReply`, `ai-warmup`, `storyArc`, `characterTraits`,
`characters/create`, `storyBook/audio`, `storyBook/actorAvatar`, `kids-flows`, `kids-generators`,
`admin/system-config/kids-flows`, `admin/sessions`, `parent/storybooks[/thumbnails]`,
`stories/[storyId]/storybooks[/[storybookId]/pages]`, and the `runKidsWizardStep` server action.

## Routes that are public by design

| Route | Why |
|-------|-----|
| `GET /api/health`, `GET /api/healthz` | Deploy and canary probes. No user data |
| `GET /api/printOrders/products` | Product catalogue. Phase 3: trim internal fields (`mixamSpec`) |
| `GET /api/storyBook/share` | Share token, plus optional passcode |
| `DELETE /api/persona` | Clears the caller's own persona cookie |
| `GET /api/webhooks/mixam` | Static readiness message |

## Routes already correct before Phase 0

Token plus an ownership check: `user/onboarding`, `children`, `children/[childId]` (the other
routes of this list — `parent/storybooks*`, the old `stories` reads and their `storybooks` routes,
`storySession`, `storybookV2/create` — are deleted or rewritten on `withRoute`). Token only (config reads):
`imageStyles`, `storyOutputTypes`. All `admin/*` routes require an admin token. The rest of the
127 route files authenticate on every method; the Phase 0 audit checked each one.

## Known gaps

Phase 3 closed the gaps listed here earlier (query-string tokens, self-writable roles). Open items
and their owners are tracked in `security/threat-model.md`.
