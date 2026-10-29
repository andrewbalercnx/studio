# ADR-0005: The browser reads; the server writes

**Status**: Proposed

## Context

The web app writes sessions, transcripts, storybooks, children and characters directly through the
client SDK, so business rules (allowances, shapes, statuses) are scattered across pages and can be
bypassed by editing documents. Firestore rules let owners write any field, including fields the
server trusts.

## Decision

- All writes to user data go through API routes (or self-authenticating server actions), which
  apply one guard: token, ownership, persona.
- The browser may **read** its own documents directly, so live progress through listeners stays.
- Firestore rules for user data: owner read, admin write, no client writes. Storage uploads go
  through signed upload URLs issued by the API.

## Consequences

- The "server-first" principle in CLAUDE.md becomes enforceable instead of advisory.
- Web, kids PWA and mobile share one API; `packages/api-client` becomes the only client.
- Every current client write needs an API route; this is most of Phase 5's client work.
