# Threat Model

> **Created**: 2026-10-29 · Phase 3 of `../REVIEW_PLAN.md`. Updated in slice 5.4 (creation findings resolved).
> Covers the system as deployed. The target architecture (`../target/`) removes several of these
> risks by design; where a fix belongs to a Phase 5 slice, it is marked so.

## What we protect

| Asset | Why it matters |
|-------|----------------|
| **Children's photos and likeness data** (photos, appearance descriptions, portraits, avatars) | Personal data of minors; the most sensitive thing the system holds |
| **Children's profiles and stories** | Personal data of minors (names, ages, preferences, story content) |
| **Parent accounts** (email, addresses, PIN) | Personal data; the PIN keeps children out of parent mode |
| **Money and allowances** | AI spend per call; story/storybook allowances; print orders that cost us money at Mixam |
| **Print integrity** | What Mixam prints and ships must be the book the parent approved |
| **Curated configuration** | Prompts, styles, layouts: product IP |

## Who might attack

| Actor | Capability | Realistic goal |
|-------|------------|----------------|
| Anonymous internet user | Can call any public URL | Free AI usage; scrape children's data by guessing IDs |
| Signed-in parent (any account) | Valid Firebase token; can run code in the browser (devtools, scripts); signup is open | Read or alter another family's data; bypass allowances or payment; plant content |
| A child on the parent's device | The parent's signed-in session, persona cookie set | Get into parent mode (PIN), act as a sibling |
| Compromised or spoofed third party | Can POST to webhooks | Forge order status, tracking links |

## Trust boundaries

1. **Browser → Firestore (client SDK)**: governed only by `firestore.rules`. Anything the rules
   allow, any signed-in user can do with a script.
2. **Browser → API routes / server actions**: the route must authenticate and check ownership;
   the Admin SDK it uses ignores the rules. Server actions are public endpoints too.
3. **Third party → webhooks**: must be authenticated by signature.
4. **Server → AI providers / Mixam / Storage**: credentials in Secret Manager.

## Findings and status

### Fixed

| Finding | Fixed in |
|---------|----------|
| 13 story, AI, storybook and print routes had no authentication | #7 |
| 6 routes authenticated but did not check ownership; 8 skipped the owner check when the field was missing | #7 |
| Character creation took the owner and child from the request body | #7 |
| Mixam webhook accepted unsigned requests | #7 |
| `/api/healthz` returned server log lines to anyone | #7 |
| Kids wizard was an unauthenticated server action | #9 |
| Placeholder name lookup searched all families (another family's photos in prompts) | #9 |
| Owners could write `printOrders` (status, payment, PDF URLs) and `printStoryBooks` PDFs | #9 |
| Owners could write server-trusted session fields (`storyAllowanceConsumed`, compile lock) | Phase 3 |
| Owners could write storybook lock, finalization (printable PDF URLs used by orders), art status and generation state; could write pages and share tokens | Phase 3 |
| Owners could rewrite story documents (text, lock, cast) | Phase 3 |
| Owner fields could be changed on update, moving a document into another family | Phase 3 |
| Any signed-in user could create `help-*` documents that every user can read | Phase 3 |
| Users could grant themselves roles, replace the parent PIN hash, and clear a PIN lockout | Phase 3 |
| Every signed-in user could read all of `systemConfig` (email settings, business addresses, Mixam payment mode) | Phase 3 |
| Auth helpers accepted ID tokens in the query string | Phase 3 |
| `/api/storyFriends` lacked the persona-scope check | Phase 3 |
| `my-orders` returned our cost snapshot, the Mixam product spec, process logs and admin ids | Phase 3 |
| `/api/children` returned soft-deleted children | Phase 3 |
| Mixam webhook applied updates for a different Mixam order, could move delivered/cancelled orders backwards, and returned 200 on internal errors | Phase 3 |
| Rules changes were untested | Phase 3: `npm run test:rules` in CI (emulator; 67 cases after slice 5.4) |
| The AI compiled from a transcript (`storySessions/{id}/messages`) that the browser wrote | Slice 5.4 (5.3 PR #15 + 5.4): turns are written only by the creation routes; `storySessions` is gone and the rules deny every client write under `stories` |
| Story sessions were created from the browser (8 client paths with different shapes; the web paths had no allowance check and backfilled `ownerParentUid`) | Slice 5.4: Stories are created only by `POST /api/stories` (child ownership, persona, live mode and allowance checked) |
| Wizard and Friends never passed through compile, so the story allowance was not charged | Slice 5.4: every mode ends via `story.finish`, which consumes one `story_allowance` |
| Two browser paths created storybooks without the storybook allowance check | Slice 5.2 (#14): Books are created only by `POST /api/books` |

### Accepted until a Phase 5 slice replaces the code

These need the rebuilt flows; fixing them in today's code would mean rewriting code that is about
to be replaced.

| Finding | Severity | Resolved by |
|---------|----------|-------------|
| Children and characters are created from the browser (sessions and storybooks no longer are) | Medium | Characters slice (ADR-0005) |
| No payment; order creation and Mixam submission have no idempotency | High once real orders flow | Print slice with Stripe (ADR-0012) and idempotent `order.submit` |
| Regenerated PDFs overwrite files referenced by placed orders | Medium | Book slice: immutable renders (ADR-0010) |
| `users.roles.isParent` is set at signup by the client, so "parent" means "signed in" | Low: signup is open anyway, and since #7 every user-data route checks ownership, not the role | Nothing further; the role must never gate access to another family's data |

### Residual risks (no change planned)

| Risk | Why accepted |
|------|--------------|
| The persona scope only restricts a browser that carries the cookie; mobile has none | Personas are a child-safety convenience inside one family's account, not a security boundary between families |
| Children's photos are readable by the owner and through tokenised Storage URLs | Required for the product; URLs are unguessable. Review Storage rules and URL lifetimes in the likeness slice |

## Rules for new code

- Every route goes through one guard (today `src/lib/route-auth.server.ts`; Phase 4 `withRoute`).
- Server actions verify the ID token and ownership themselves; Genkit flows and `'use server'`
  modules are never imported into client components.
- The browser never writes a field the server trusts. When a rule or a client write changes, add
  a case to `tests/firestore-rules/check-rules.mjs`.
- Stories, turns, Books and Manuscripts are server-written only: clients read them (owner-filtered
  listeners or the read routes) and change them only through the routes, with an idempotency key
  per user action.
- Webhooks verify a signature, accept only the expected object, and never move an object out of a
  final state.
- Tokens travel in the `Authorization` header only.
