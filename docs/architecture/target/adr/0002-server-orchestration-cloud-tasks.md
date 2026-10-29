# ADR-0002: Server-side orchestration with Cloud Tasks

**Status**: Proposed

## Context

Storybook generation advances only while the browser tab is open: the page calls the pages route,
waits, then calls the images route. Background work runs as unawaited promises inside a request.
App Hosting requests time out at 300 s; the images route regularly approaches that, and a timeout
leaves a `running` flag that blocks every retry.

## Decision

Pipeline work runs as **Jobs** (ADR-0003) executed by **Google Cloud Tasks**, which call an
internal route (`/api/internal/jobs/run`) in the same Next.js app with an OIDC token. One task per
unit of work (one page image, one reference sheet). Separate queues per resource (`ai-text`,
`ai-image`, `tts`, `render`, `mixam`) carry rate limits and retry/backoff. A job's completion
enqueues the next step inside a transaction. Tests and local development use an in-process
runner with the same interface.

## Consequences

- Closing a tab no longer stops a book; every unit fits inside the request timeout.
- Provider rate limits are enforced by queue configuration instead of hit and retried.
- New infrastructure: queues, an IAM binding for the invoker service account, and a deploy step
  for queue configuration.

## Alternatives

- **Firestore-triggered Cloud Functions**: event-driven and well supported, but a second
  deployable with its own runtime, cold starts and harder local testing.
- **Cloud Workflows**: explicit orchestration, but a separate YAML language and still needs
  workers for the AI calls.
- **Next.js `after()`**: no new infrastructure, but work dies with the instance and is still
  bound by the request timeout.
