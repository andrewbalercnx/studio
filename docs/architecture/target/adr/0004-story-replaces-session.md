# ADR-0004: The Story replaces the session

**Status**: Accepted (owner, 2026-10-29)

## Context

Today a `storySessions` document holds the conversation and a `stories` document (same id) holds
the result. Sessions are created in eight browser code paths with different shapes, mirrored into
`children/{id}/sessions`, and their status doubles as a mode marker.

## Decision

One **Story** entity covers creation and result. Creation is a status (`creating`), the
conversation is a `turns` subcollection written by the server, and the finished text lives on the
same document. A Story is created only by `POST /api/stories`.

## Consequences

- One id, one owner check, one place to look; the mirror collection and the id-equality
  convention disappear.
- "Abandoned" stories are visible as such instead of dangling sessions.
