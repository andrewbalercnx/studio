# Target Architecture (Phase 2)

> **Created**: 2026-10-29 · Phase 2 of `../REVIEW_PLAN.md`. The model the rebuild builds to.
> The current system is described in `../as-is/`; `../../SYSTEM_DESIGN.md` and
> `../../SCHEMA.md` keep describing what is deployed until each slice ships.

## In one paragraph

A child creates a **Story** with the AI in one of five **creation modes**, all behind one
interface and three routes. A finished Story becomes one or more **Manuscripts**: the words in a
chosen form (picture book, poem…), split into a fixed number of story pages with scene notes, plus
narration. A Manuscript becomes one or more **Books**: an art style and a layout, with cast
reference sheets drawn from each person's canonical portrait, page art, and immutable renders for
screen and print. A **PrintOrder** pins one render. The server drives every step as small,
leased, retryable **Jobs** run by Cloud Tasks; the browser starts things and watches, and never
writes.

## Documents

| Document | Covers |
|----------|--------|
| [`domain-model.md`](domain-model.md) | Entities, names, collections, ownership, the Story → Manuscript → Book contract |
| [`pipeline.md`](pipeline.md) | Jobs, the status vocabulary, orchestration, state machines for Story, Manuscript, Book, PrintOrder, Likeness |
| [`creation.md`](creation.md) | The five creation modes, the engine interface, the three creation routes |
| [`adr/`](adr/) | One record per decision |

## Decisions

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](adr/0001-story-manuscript-book.md) | Story → Manuscript → Book; length and density are the contract between B and C | **Accepted** |
| [0002](adr/0002-server-orchestration-cloud-tasks.md) | Server-side orchestration with Cloud Tasks | Proposed |
| [0003](adr/0003-one-job-model.md) | One job model; `queued / running / succeeded / failed / cancelled`; leases; `partial` is an outcome | Proposed |
| [0004](adr/0004-story-replaces-session.md) | The Story replaces the session; turns are server-written | Proposed |
| [0005](adr/0005-browser-reads-server-writes.md) | The browser reads its own data; only the server writes | Proposed |
| [0006](adr/0006-likeness-from-photos.md) | Likeness from photos: appearance + canonical portrait; no stock placeholders | **Accepted** |
| [0007](adr/0007-one-name-one-owner-field.md) | One name per concept; `ownerUid` everywhere | Proposed |
| [0008](adr/0008-ai-harness-model-registry.md) | One AI harness; models chosen by purpose from one registry | Proposed |
| [0009](adr/0009-creation-modes-one-interface.md) | Five creation modes behind one interface | **Accepted** (modes); Proposed (interface) |
| [0010](adr/0010-immutable-renders.md) | Renders are immutable; orders pin a render | Proposed |

## How today maps onto the target

| Today | Target |
|-------|--------|
| `storySessions` + `stories` (same id) + `children/{id}/sessions` | `stories` (status `creating` → `complete`) + `turns` |
| `storyGenerators`, `systemConfig/kidsFlows`, mode-specific routes | `creationModes` + one engine per mode + 3 routes |
| `storyOutputTypes` | `forms` |
| Pagination inside storybook generation | `manuscripts` + pages (`manuscript.paginate`) |
| `stories/*/storybooks`, `outputs/storybook`, `storyBooks`, `printStoryBooks` | `books` (+ pages, cast sheets, renders) |
| `storybook.actorExemplarUrls` (per story path) | `books/{id}/castSheets` |
| `finalization.printable*`, `generate-pdfs`, `storyBook/printable` | `book.render` with a print Layout → immutable render |
| `imageStyles`, `printLayouts` | `styles`, `layouts` (with supported lengths/densities, `medium`) |
| Canonical portrait (unused), picsum avatars | Likeness: `appearance`, `portrait`, `avatar` (UI only) |
| 40+ status fields | Job statuses + small entity lifecycles |
| Browser-driven steps, unawaited promises, `after()` | Jobs on Cloud Tasks |
| Client SDK writes everywhere | API routes only; client reads |
| `parentUid` / `ownerParentUid` / `ownerUserId` | `ownerUid` |

Trial user data is not migrated (`../REVIEW_PLAN.md` constraints). Curated config is exported
with `scripts/export-config.mjs` and re-seeded into the target collections by a mapping script
written in Phase 4.

## Open questions for the owner

1. **Orchestration (ADR-0002)**: Cloud Tasks inside the existing app (recommended) or
   Firestore-triggered Cloud Functions?
2. **Length menu**: which story-page counts should each Form offer? Proposal for picture books:
   12, 16 or 24 story pages. The Book adds title, dedication and end pages, then pads to the print
   product's rules (Mixam case binding: at least 24 interior pages, in multiples of 4), so 12 or 16
   story pages print as 24 pages and 24 story pages as 28. Poems and colouring pages may want
   different menus.
3. **Who chooses what**: does the child choose the Form and Style (with the parent choosing the
   Layout and print product), or does the parent choose everything after the story?
4. **Payment**: is a real payment provider (Stripe) in scope for the rebuild, or do orders stay
   admin-marked-paid until later?
5. **The Proposed ADRs**: accept as written, or discuss any?

## Next

Once the open questions are answered and the Proposed ADRs accepted, Phase 3 (security review in
depth, using `../as-is/open-risks.md`) and Phase 4 (foundations: layering, repositories with
schemas, the AI harness, the job runner) can start.
