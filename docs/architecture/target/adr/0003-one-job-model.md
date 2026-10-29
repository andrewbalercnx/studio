# ADR-0003: One job model and status vocabulary

**Status**: Proposed

## Context

"In progress" is spelled `running`, `generating`, `in_progress` and `pending` across 40+ status
fields; several declared values are never written and several written ones are not typed. Locks
are plain reads, so a crash leaves work stuck. A partly illustrated book is marked `error`.

## Decision

- All work is a **Job** document (`jobs/{jobId}`) with `status` ∈ `queued | running | succeeded |
  failed | cancelled`, an attempt count, an idempotency key and a **lease**. A job whose lease has
  expired is retried; nothing stays `running` forever.
- Entities carry a small lifecycle `status` (for example Book: `draft | illustrating | ready |
  partial | failed | locked`) and progress derived from their jobs.
- `partial` is an outcome, not an error. Rate limiting is a retryable error with a delay.

## Consequences

- One component renders progress for any job; one query answers "what is running for this family".
- Retrying is the same operation everywhere.
- The legacy per-field statuses are removed with the code that writes them.
