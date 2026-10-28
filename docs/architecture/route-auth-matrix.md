# Route Auth Matrix

> **Last Updated**: 2026-10-28 (Phase 0 of `REVIEW_PLAN.md`)
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

Owner fields: `storySessions.parentUid`, `stories.parentUid`, `children.ownerParentUid`,
`characters.ownerParentUid`, `printStoryBooks.ownerUserId`, `printOrders.parentUid` (legacy:
`ownerUserId`).

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

## Routes that are public by design

| Route | Why |
|-------|-----|
| `GET /api/health`, `GET /api/healthz` | Deploy and canary probes. No user data |
| `GET /api/kids-flows` | Boolean feature switches |
| `GET /api/kids-generators` | Live generator list with internal fields stripped |
| `GET /api/printOrders/products` | Product catalogue. Phase 3: trim internal fields (`mixamSpec`) |
| `GET /api/storyBook/share` | Share token, plus optional passcode |
| `DELETE /api/persona` | Clears the caller's own persona cookie |
| `GET /api/webhooks/mixam` | Static readiness message |

## Routes already correct before Phase 0

Token plus an ownership check: `parent/storybooks`, `parent/storybooks/thumbnails`,
`user/onboarding`, `stories`, `stories/[storyId]` and its `storybooks` and `pages` routes,
`children`, `children/[childId]`, `storySession`, `storybookV2/create`. Token only (config reads):
`imageStyles`, `storyOutputTypes`. All `admin/*` routes require an admin token. The rest of the
127 route files authenticate on every method; the Phase 0 audit checked each one.

## Known gaps left for Phase 3

- Both auth helpers accept the ID token in an `?idToken=` query string, which puts tokens in URLs
  and logs.
- `users/{uid}.roles.isParent` is user-writable under `firestore.rules`, so "parent" means "signed in".
- No rate limits on AI routes beyond the entitlement check in `storyCompile`.
- The `/kids/*` PWA reads Firestore directly, governed only by `firestore.rules`.
