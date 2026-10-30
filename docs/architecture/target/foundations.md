# Foundations (Phase 4)

> Phase 4 of `../REVIEW_PLAN.md`. The server modules every Phase 5 slice is built on, and how to
> use them. They live in `src/server/` and are server-only (lint forbids importing them from
> components, hooks, contexts, pages and layouts). Until a slice adopts them they are unused.

```
src/server/
  errors.ts          typed errors → HTTP statuses
  http/              withRoute, token verification, ownership guards
  data/              zod schemas for the target entities, repositories
  jobs/              JobRegistry, JobRunner, in-process and Cloud Tasks dispatchers
  ai/                AIModelRegistry (purpose → model), AIHarness (aiCall / aiGenerateText / aiGenerateImage)
  config/            ConfigService (one typed loader, one cache)
  catalog/           Form, Style, Layout in target shapes (read from today's collections)
  books/             slice 5.1: the Book pipeline (services, job kinds) — see slices/5.1-book-server.md
  creation/          slice 5.3: Story creation (mode engines, services, story.finish) — see slices/5.3-creation-server.md
  testing/           FakeFirestore for unit tests
```

The layering a slice follows: **route** (parse, guard, call a service, respond) → **service**
(domain logic, in the slice's own folder, e.g. `src/server/books/`) → **repositories** (the only
Firestore access) and **jobs** / **AI harness**.

## 1. Routes: `withRoute`

```ts
// src/app/api/books/[bookId]/retry/route.ts
import { z } from 'zod';
import { withRoute, loadOwned, ConflictError } from '@/server/http';
import { books } from '@/server/data';
import { retryMissingPages } from '@/server/books/service';

const Body = z.object({ pageNumbers: z.array(z.number().int().positive()).optional() });

export const POST = withRoute<'user', typeof Body, { bookId: string }>(
  { auth: 'user', body: Body },
  async ({ user, params, body }) => {
    const book = await loadOwned(user, books, params.bookId);   // 400 / 404 / 403 / persona
    if (book.status === 'locked') throw new ConflictError('Unlock the book first', { code: 'BOOK_LOCKED' });
    return retryMissingPages(book, body.pageNumbers);             // → { ok: true, data }
  }
);
```

- `auth`: `public`, `user` (Firebase ID token in the `Authorization` header; there is no
  `?idToken=` fallback), `admin` (`isAdmin` claim), `internal` (Cloud Tasks OIDC; only for
  `/api/internal/*`).
- The body is parsed with the zod schema; failures are 400 `INVALID_BODY` with the issues.
- Return a value for `{ ok: true, data }`, `ok(data, 201)` for another status, or a `Response`
  (files, streams) to bypass the envelope.
- Throw `BadRequestError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`,
  `ConflictError`, `ServiceUnavailableError` (503; each takes `{ code, details }`). Any other error is a 500 with a generic
  message; `DataIntegrityError` is a 500 whose details are only logged.
- Ownership: `loadOwned(user, repo, id)` or, for a doc already loaded, `assertOwner(user, doc,
  label)`. Both compare `ownerUid` (missing = not yours), exempt admin/writer, and apply the
  child-persona scope with the document's `childId` (403 `PERSONA_SCOPE_MISMATCH`).

## 2. Data: schemas and repositories

Schemas (`src/server/data/schemas/*`) follow `domain-model.md`: `Job`, `Story` + `CastMember`,
`Manuscript` + `ManuscriptPage` (+ `Scene`), `Book` + `BookPage`, `CastSheet`, `Render`, and the
embedded `Likeness`. Repositories (`src/server/data/repositories.ts`):

| Repository | Collection |
|------------|------------|
| `jobs` | `jobs` |
| `stories` | `stories` |
| `manuscripts`, `manuscriptPages.of(id)` | `manuscripts`, `manuscripts/{id}/pages` |
| `books`, `bookPages.of(id)`, `castSheets.of(id)`, `renders.of(id)` | `books`, `books/{id}/pages`, `/castSheets`, `/renders` (immutable) |

```ts
import { books, bookPages } from '@/server/data';

const bookId = await books.create({ ownerUid: user.uid, childId, manuscriptId, storyId,
  styleId, layoutId, status: 'draft' });          // validated; createdAt/updatedAt stamped
const book = await books.require(bookId);         // parsed: Book & { id }; NotFoundError if absent
await books.update(bookId, { status: 'illustrating' });   // per-field validation, updatedAt stamped
const mine = await books.listByOwner(user.uid);
await bookPages.of(bookId).create({ ownerUid: user.uid, pageNumber: 1, kind: 'cover' }, { id: '1' });

// In a transaction: all reads first, then writes (Firestore's rule)
await db.runTransaction(async (tx) => {
  const b = await books.requireIn(tx, bookId);
  await books.updateIn(tx, bookId, { art: { ...b.art, done: b.art.done + 1 } });
});
```

- Reading a document that does not match its schema throws `DataIntegrityError` (500, logged
  with the path and the zod issues). Fix the data or the schema; never widen to `any`.
- `update` takes top-level fields only (no dotted paths); `FieldValue` sentinels pass through.
- Tests bind a repository to a fake or the emulator: `books.using(new FakeFirestore().asFirestore())`.
- `replaceIn(tx, id, data)` creates or fully replaces a document (validated like `create`), for
  handlers that rewrite the same document when retried.
- Child and Character repositories are added by the Characters slice (they embed
  `likenessSchema`). Story turns were added by the creation slice (`storyTurns.of(storyId)`, slice 5.3).

## 3. Jobs

A slice registers its job kinds in `src/server/jobs/kinds.ts` (`registerJobKinds`, called when
`jobRegistry` is built in `src/server/jobs/index.ts`) and enqueues jobs from its services. Slice 5.1
registers the Book pipeline there (`registerBookJobs`). Handlers import from `../jobs/registry` and
`../jobs/runner`, not from `../jobs`, to avoid an import cycle.

```ts
import { jobRegistry, JobFailure } from '@/server/jobs';

jobRegistry.register({
  kind: 'book.pageArt',
  queue: 'ai-image',                 // ai-text | ai-image | tts | render | mixam
  maxAttempts: 4,                    // default 3
  async run({ job }) {
    const { bookId, pageNumber } = job.input as { bookId: string; pageNumber: number };
    // … build the prompt, call aiGenerateImage, upload, write the page …
    if (!scene) throw new JobFailure('NO_SCENE', 'Page has no scene', { retryable: false });
  },
});

jobRegistry.register({
  kind: 'book.illustrate',           // a coordinator: fans out, then fans in
  queue: 'render',
  async run({ job, enqueueChildren }) {
    await enqueueChildren(pages.map((p) => ({ kind: 'book.pageArt', ownerUid: job.ownerUid,
      target: { collection: 'books', id: bookId, subpath: `pages/${p}` }, input: { bookId, pageNumber: p } })));
  },
  onChildrenComplete({ parent, children }) {        // also gets { tx, db } for reads; pure: may re-run if the transaction retries
    const failed = children.some((c) => c.status === 'failed');
    return {
      enqueue: [{ kind: 'book.render', ownerUid: parent.ownerUid, target: parent.target, input: { medium: 'screen' } }],
      apply: (tx) => books.updateIn(tx, parent.target.id, { status: failed ? 'partial' : 'ready' }),
    };
  },
});
```

Enqueueing:

```ts
import { getJobRunner } from '@/server/jobs';

// On its own:
await getJobRunner().enqueue([{ kind: 'likeness.describe', ownerUid, target: { collection: 'children', id: childId } }]);

// Together with the entity change (pipeline.md): enqueue first (it reads), write, dispatch after commit.
const pending = await db.runTransaction(async (tx) => {
  const p = await getJobRunner().enqueueInTransaction(tx, [spec]);
  await books.updateIn(tx, bookId, { status: 'illustrating' });
  return p;
});
await pending.dispatch();
```

Rules the runner enforces:

- **Idempotency**: the job id is derived from `idempotencyKey` (default
  `${kind}:${collection/id[/subpath]}:${hash(input)}`), so the same request twice is one job.
  Pass an explicit key where the inputs alone do not identify the work (e.g. `story.finish` uses
  the story id). Re-enqueueing a `queued` job re-dispatches it, which recovers a lost dispatch.
- **Lease**: `runJob` takes a lease in a transaction (`leaseMs`, default 6 min, longer than the
  300 s request timeout). A delivery that finds a live lease gets 409 and Cloud Tasks redelivers;
  an expired lease is taken over as a new attempt.
- **Retries**: errors are classified with `src/lib/ai-retry.ts` (`JobFailure` overrides it). A
  retryable failure goes back to `queued` and is re-dispatched with backoff (rate limits back off
  harder) until `maxAttempts`; otherwise the job is `failed` with `error { code, message, retryable }`.
- **Fan-in**: `onChildrenComplete` runs once when the coordinator has succeeded and every child is
  terminal (`succeeded`, `failed` or `cancelled`). Enqueue all children in one call as the
  coordinator's last step. Partial failure is the handler's decision (a Book can be `partial`).
- **Handlers must be idempotent**: a crash after the work but before the success write means
  the work runs again.

Dispatchers: `JOBS_DISPATCHER=cloud-tasks` uses Cloud Tasks (one task per job attempt, named
`{jobId}-{attempt}` so duplicates are rejected, on queue `${JOBS_QUEUE_PREFIX}${queue}`, HTTP
POST to `JOBS_RUN_URL` with an OIDC token for `JOBS_INVOKER_SERVICE_ACCOUNT`). Anything else uses
the in-process dispatcher, which runs jobs asynchronously in the same process (tests, local dev,
emulator E2E). **Production must set `cloud-tasks`** before the first slice ships: in-process
work dies with the instance. Tests use `new InProcessDispatcher({ sleep: async () => {} })` and
`await dispatcher.drain()`.

Before the first job kind ships, create the queues and the invoker service account with
`roles/run.invoker` (or App Hosting equivalent) and `roles/cloudtasks.enqueuer` for the app's
runtime account, and set the env vars above in `apphosting.yaml`.

## 4. AI harness

```ts
import { aiGenerateText, aiGenerateImage, aiCall } from '@/server/ai';

const { output } = await aiGenerateText({
  purpose: 'manuscript.text',
  flowName: 'manuscript.paginate',
  ownerUid: job.ownerUid,
  system, prompt,
  output: { schema: PagesSchema },
});

const { mediaUrl } = await aiGenerateImage({
  purpose: 'book.pageArt', flowName: 'book.pageArt', ownerUid,
  prompt: [{ media: { url: castSheetDataUri } }, { text: pagePrompt }],
});

// A creation mode passes its override; only creation.text accepts one.
await aiGenerateText({ purpose: 'creation.text', creationModeModel: mode.model ?? null, flowName: 'guided.respond', prompt });

// Non-Genkit providers (narration) use the generic call for the same model/retry/log policy.
const { result: audio } = await aiCall({ purpose: 'narration', flowName: 'manuscript.narrate',
  run: (model) => elevenLabs.textToSpeech(text, model.model.replace('elevenlabs/', '')) });
```

- Models come from `config/aiModels` (`{ purposes: { 'book.pageArt': 'googleai/…' } }`, 30 s
  cache, `invalidateConfig(aiModelsConfig)` after an admin write), falling back to
  `DEFAULT_AI_MODELS`, which match today's flows. No other code picks a model.
- Each call runs under the shared Firestore-backed circuit breaker for its provider and
  `withRetry` (transient errors; an image call that returns no image is retried too).
- One `aiFlowLogs` entry per call (final outcome, attempt count), written only when
  `systemConfig/diagnostics.enableAIFlowLogging` is on.
- Flow code builds prompts and parses output; it does not wire retries, breakers or logs.
  Keep the CLAUDE.md rule: `likeness.describe` prompts use the original photos only.

## 5. Config

```ts
import { z } from 'zod';
import { defineConfig, getConfig, invalidateConfig } from '@/server/config';

export const layoutDefaultsConfig = defineConfig({
  path: 'config/layoutDefaults',
  schema: z.object({ defaultLayoutId: z.string(), allowPrint: z.boolean() }),
  defaults: { defaultLayoutId: 'square-24', allowPrint: true },
});

const cfg = await getConfig(layoutDefaultsConfig);   // typed; defaults merged; 60 s cache
invalidateConfig(layoutDefaultsConfig);              // after an admin save (or invalidateConfig() for all)
```

A missing document gives the defaults; a malformed one logs and gives the defaults; a Firestore
error gives the defaults without caching them. When a slice moves a `src/lib/*-config.server.ts`
loader onto the service, it deletes the old loader in the same PR.

## Testing

- Unit tests use `FakeFirestore` (`src/server/testing/fake-firestore.ts`): transactions are
  serialised and reject reads after writes, like the real SDK.
- The job runner suite also runs against the Firestore emulator when `FIRESTORE_EMULATOR_HOST`
  is set (it is skipped otherwise, so `npm test` needs no emulator):

  ```bash
  npx --yes firebase-tools@15.20.0 emulators:exec --only firestore --project demo-x "npx vitest run src/server/jobs"
  ```

## Decisions where the target docs were silent

| Topic | Decision |
|-------|----------|
| Job inputs | `Job.input` (a map) carries the handler's input; the default idempotency key hashes it |
| Job ids | Derived from the idempotency key (`job_` + sha256 prefix), so idempotency needs no query |
| Fan-in marker | `Job.fanInCompletedAt` on the coordinator records that its fan-in ran |
| `childId` on Manuscript and Book | Denormalised from the Story so the persona guard needs no second read |
| `ownerUid` on subcollection docs | Pages, cast sheets and renders carry it too, so rules and guards check every document the same way |
| Job progress on entities | `JobSummary { jobId, status }`: `BookPage.artJob`, `CastSheet.job`, `Likeness.likenessJob.{describe,portrait}` (two jobs, shown separately per pipeline.md) |
| `Manuscript.density`, `form`, `readingLevel` | Free strings (ids declared by the Form); `length` a positive integer (Forms declare the allowed values) |
| `Manuscript.narration` | `{ voiceId }` or null |
| `Book.art` rollup | `{ total, done, failed }` |
| `CastSheet.source` | `portrait` or `appearance` (no photos), so the UI can say which |
| `Render.files` | `[{ role, storagePath, url? }]` plus `medium` and `layoutId` |
| `Story.storyTypeId` | Nullable; set for the `adventure` mode |
| Narration model id | `elevenlabs/eleven_v3`, provider-prefixed like the Genkit ids |
| `config/aiModels` shape | `{ purposes: { [purpose]: modelId } }` |
| Response envelope | `{ ok: true, data }` / `{ ok: false, error: { code, message, details? } }` |
