# ADR-0006: Likeness comes from photos; canonical portrait wired in

**Status**: Accepted (owner, 2026-10-29)

## Context

Canonical portraits are generated on every photo upload and used by nothing. Reference sheets are
built from `avatarUrl`, which can be a random stock photo, and raw photos. CLAUDE.md describes a
canonical → reference-sheet pipeline that does not run.

## Decision

Each Child and Character has a **Likeness**:

- `appearance`: text description generated from the original `photos` only (the CLAUDE.md rule
  stands);
- `portrait`: canonical portrait generated from `photos`;
- `avatar`: for the UI only, never used as a likeness.

A Book's cast reference sheet for a member is generated from that member's `portrait` (visual
anchor) and `appearance` (verbal anchor), in the Book's style. With no photos, the sheet is drawn
from `appearance` alone and the UI says so. No stock placeholder image is ever used.

## Consequences

- The two complementary signals CLAUDE.md describes both reach the images.
- Reference sheets are per Book (ADR-0001), so they can never collide.
