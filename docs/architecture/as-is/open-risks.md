# Open Risks (input to Phase 3)

> Phase 1 of `../REVIEW_PLAN.md`. Security, privacy, billing and data-integrity problems found
> while mapping the system that are **not** fixed yet. Items fixed during Phase 1 are listed at
> the end. Citations are in the area maps under `areas/`.

## Security and privacy

| Risk | Where | Severity |
|------|-------|----------|
| Rules let the owner write **any field** of their sessions and storybooks, including `status`, `storyAllowanceConsumed`, `isLocked`, generation statuses; compile and finalize trust them | `firestore.rules` (`storySessions`, `stories/**`) | High |
| The AI compiles from a transcript (`storySessions/{id}/messages`) that only the browser writes | creation-modes §5 | Medium |
| Every signed-in parent can read all of `systemConfig` (email templates, business addresses, Mixam payment mode) | `firestore.rules` | Medium |
| `/api/storyFriends` lacks the persona-scope check `/api/storyWizard` has | creation-modes §6 | Low |
| `my-orders` returns raw order documents, including our cost snapshot and Mixam logs | print-orders §6 | Low |
| `/api/children` returns soft-deleted children and internal fields | characters-actors §6 | Low |
| Other `'use server'` modules (`ledger.server.ts`, `seed-print-products.ts`, config loaders) export unauthenticated functions. None is imported by client code today, so none is callable; a lint rule should keep it that way | `src/lib` | Latent |
| Both auth helpers accept `?idToken=` in the query string | `server-auth.ts`, `auth-utils.ts` | Low |
| `users.roles.isParent` is self-writable, so "parent" means "signed in" | `firestore.rules` | Low |

## Billing and entitlements

| Risk | Where |
|------|-------|
| Wizard and Friends stories never pass through compile, so `story_allowance` is never charged for the two most-used modes | creation-modes §6.1 |
| Two client paths create storybooks directly, skipping the `storybook_allowance` check; generation routes do not check it either | storybook-pipeline §6.3 |
| The web `/story/start/*` pages have no story-allowance check (only the kids PWA does) | clients §2c |
| No payment: parents see our Mixam cost as the price; `/pay` marks orders paid; approve and submit ignore payment | print-orders §1d |

## Data integrity

| Risk | Where |
|------|-------|
| Order creation has no idempotency key; submit and resubmit check-then-write without a transaction, so two clicks can both reach Mixam; a lost Mixam response returns the order to `approved` and a retry creates a second job | print-orders §6c |
| Mixam webhook does not check the incoming order id against `mixamOrderId`, has no guard against leaving a final state, maps unknown statuses to `submitted`, and returns 200 on internal errors | print-orders §6c |
| Regenerating PDFs overwrites the same Storage path with a new token, breaking URLs on existing orders and changing the artwork behind a placed order | print-orders §6c |
| Actor exemplars are stored per story, not per storybook; a second storybook overwrites the first one's references | storybook-pipeline §6.3 |
| Stuck `running` locks after a timeout or crash block every retry with 409 | status-audit |
| Nothing server-side chains pages → images; closing the browser tab stops a book | status-audit |
| Random picsum placeholder avatars are fed to image generation as if they were the character | characters-actors §6.3 |

## Fixed during Phase 1 (Phase 0 follow-up PR)

- `storyWizardFlow` exposed as an unauthenticated server action via `/kids/create`.
- Placeholder name fallback looked up `displayName` across all families (cross-family photo and
  detail leak into prompts).
- `printOrders` rules let owners write status, payment and PDF URLs; `printStoryBooks` rules let
  owners set PDF URLs and `pdfStatus`.
