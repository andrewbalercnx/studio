# ADR-0009: Five creation modes behind one interface

**Status**: Accepted (owner, 2026-10-29)

## Context

Each mode has its own routes, session shape and ending; Wizard and Friends skip compile, so they
miss title, synopsis and allowance charging; mobile runs every mode as the wizard.

## Decision

Modes kept: `wizard`, `freeplay` (today gemini3), `guided` (today gemini4), `friends`,
`adventure` (today's beat engine). Each implements `start` and `respond` (see
`../creation.md`). Three routes serve all modes: create Story, add turn, abandon. Every mode ends
through `story.finish`.

## Consequences

- Retired: Chat, the legacy warmup session, the arc engine test route, dead flows.
- Adding a mode means one engine and one config document, no new routes or pages.
