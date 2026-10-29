# Target Pipeline: Jobs, States and Orchestration

> Phase 2 of `../REVIEW_PLAN.md`. How work moves through the system. Replaces today's
> browser-driven pipeline, where a book only advances while a tab is open
> (`../as-is/status-audit.md`).

## Principles

1. **The server drives every step.** A client starts something and then only watches. Closing
   the tab changes nothing.
2. **Every unit of work is a Job** with one status vocabulary. Entities show a status derived
   from their jobs, not spelled again per field.
3. **Work runs in units that fit inside a request.** One page image, one reference sheet, one
   narration clip. Never "all images" in one 300-second request.
4. **Jobs are idempotent and leased.** Running a job twice gives the same result. A crashed
   worker's lease expires and the job is retried, so nothing stays stuck "running".

## The Job

Collection: `jobs/{jobId}`, written by the server only and readable by the owner.

```ts
type Job = {
  jobId: string;
  ownerUid: string;
  kind: JobKind;                 // see table below
  target: { collection: string; id: string; subpath?: string };
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempt: number;
  maxAttempts: number;
  leaseUntil?: Timestamp;        // set when running; expired lease = retryable
  error?: { code: string; message: string; retryable: boolean };
  parentJobId?: string;          // fan-in: the coordinator waiting on this job
  idempotencyKey: string;        // e.g. `${kind}:${target}:${inputsHash}`
  createdAt; startedAt?; finishedAt?;
};
```

That is the only status vocabulary for work: `queued`, `running`, `succeeded`, `failed`,
`cancelled`. `generating`, `in_progress`, `pending`, `ready`, `idle`, `rate_limited` and
`error` are retired as job states. Rate limits are a retryable error with a delay, not a status.

| Job kind | Unit | Writes |
|----------|------|--------|
| `likeness.describe` | One Child or Character | `appearance` (from photos only) |
| `likeness.portrait` | One Child or Character | `portrait` |
| `story.finish` | One Story | `title`, `synopsis`; charges the story allowance |
| `manuscript.paginate` | One Manuscript | all pages' `text` and `scene` |
| `manuscript.narrate` | One Manuscript page | `narrationUrl` |
| `book.castSheet` | One cast member in one Book | `castSheets/{castId}` |
| `book.pageArt` | One Book page | `artUrl` |
| `book.render` | One Book render (screen or print) | `renders/{renderId}` |
| `order.submit` | One PrintOrder | Mixam order (idempotent on `orderId`) |

## Orchestration

**Recommended: Google Cloud Tasks calling an internal job route in the same Next.js app**
(ADR-0002).

```
API route (user action)          Cloud Tasks queue               /api/internal/jobs/run
───────────────────────          ─────────────────               ──────────────────────
create Job docs (queued)  ──▶    one task per job  ──(OIDC)──▶   verify caller is the queue
in one transaction               rate limits, retries,           lease the job (transaction)
with the entity change           backoff per queue               do the unit of work
                                                                 write result + status
                                                                 advance: enqueue next jobs
```

- **Queues per kind of resource**: `ai-text`, `ai-image`, `tts`, `render`, `mixam`. Each queue's
  rate limit stays under the provider's quota, so 429s become rare rather than routine.
- **Advancing**: when a job succeeds, the runner checks in a transaction whether its siblings
  have finished and, if so, enqueues the next step. For example, when the last
  `book.castSheet` finishes, the `book.pageArt` jobs start; when the last `book.pageArt`
  finishes, the screen render starts.
- **Security**: the job route accepts only Cloud Tasks' OIDC token for the app's service
  account. It is not reachable with a user token.
- **Local and test**: a synchronous in-process runner with the same interface, so the
  emulator E2E test runs the whole pipeline without Cloud Tasks.

Alternatives (in ADR-0002): Firestore-triggered Cloud Functions (a second deployable, cold
starts, harder local testing); Cloud Workflows (strong orchestration but a separate language);
Next.js `after()` (dies with the instance and is still bound by the request timeout).

## Entity states

Each entity has a small `status` plus derived progress. "Partial" is a first-class outcome:
a Book with some art missing is not an error.

### Story

```
creating ──(mode says done)──▶ finishing ──(story.finish ok)──▶ complete
    │                               │
    └──(abandoned)──▶ abandoned     └──(failed)──▶ failed  (retry → finishing)
```

- `creating`: turns are being added. Only the creation mode's route writes turns.
- Every mode ends the same way: the mode's route sets `finishing` and enqueues `story.finish`.
  No mode skips it (today Wizard and Friends do).
- The story allowance is charged once, inside the transaction that moves the Story to
  `complete` (`idempotencyKey` = storyId).

### Manuscript

```
draft ──▶ paginating ──▶ ready ──▶ (narration runs alongside; does not block)
               └──▶ failed
```

- Created from a `complete` Story with a Form, length and density. Paginating writes all pages
  in one job (text generation is fast; one call keeps page turns coherent).
- Narration is a set of per-page `manuscript.narrate` jobs; its progress is shown separately.

### Book

```
draft ──▶ illustrating ──▶ ready | partial ──▶ locked
              │                     │            │
              └──▶ failed           └─(retry missing pages)  └─(unlock: revokes share links)
```

- Created from a `ready` Manuscript plus a Style and a compatible Layout. Creation charges the
  book allowance in the same transaction.
- `illustrating`: cast sheets, then page art, then the screen render.
- `ready`: every page has art. `partial`: some pages failed after all retries; the book can be
  read, retried page by page, or locked anyway (the parent decides).
- `locked`: content frozen; print renders and orders allowed. Editing requires unlocking, which
  revokes share links.

### PrintOrder

```
created ──▶ awaiting_payment ──▶ paid ──▶ submitting ──▶ submitted ──▶ in_production ──▶ shipped ──▶ delivered
                  │                         │                │
                  └──▶ cancelled            └─(retry, same idempotency key)
                                                             └──▶ failed | cancelled ──▶ refunded
```

`refunded` is reached only through the Stripe webhook, from any paid state the order leaves
without being delivered (or later, if the parent is refunded after delivery).

- Payment is a real step: `awaiting_payment → paid` only on a verified Stripe webhook, or by
  print credits (ADR-0012). A parent can never mark an order paid; an admin can, as an audited
  exception.
- `submitting` → Mixam uses the order id as the idempotency key; a lost response is resolved by
  asking Mixam, never by submitting again.
- The webhook only moves an order forward, only for the order's own `mixamOrderId`, and
  returns non-200 on internal errors so Mixam retries.

### Likeness (Child or Character)

`likeness.describe` and `likeness.portrait` run when photos change. Each has its own job; the
entity shows "appearance ready" and "portrait ready" separately. A Book's cast sheets wait for
its cast's portraits (or proceed from `appearance` alone when there are no photos).

## What the browser does

- Calls an API route to start something (create Manuscript, create Book, retry page, lock,
  order).
- Watches its own documents (`books/{id}`, `books/{id}/pages`, `jobs` where `ownerUid` is theirs)
  through Firestore listeners for live progress.
- Never writes a document and never decides what step comes next.
