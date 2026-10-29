# ADR-0010: Renders are immutable; orders pin a render

**Status**: Accepted (owner, 2026-10-29)

## Context

Regenerating PDFs overwrites the same Storage path with a new token. URLs stored on orders break,
and the artwork behind a placed order can change after the parent approved it.

## Decision

Each render (screen or print) is a new `books/{id}/renders/{renderId}` record with files under a
path containing the render id. Renders are never overwritten. A PrintOrder records the `renderId`
it was placed with. Old renders can be garbage-collected only when no order or share link points
at them.

## Consequences

- What the parent approved is what gets printed.
- Storage grows with re-renders; cleanup is a scheduled job.
