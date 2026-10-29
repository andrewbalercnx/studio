# The System As It Is (Phase 1)

> **Created**: 2026-10-29 · Phase 1 of `../REVIEW_PLAN.md`.
> A read-only map of how StoryPic Kids works today, as input to the Phase 2 target model.
> Describes what **is**, including what is broken; it does not propose fixes.

## How to read this

| Document | What it answers |
|----------|-----------------|
| [`glossary.md`](glossary.md) | Every name each concept goes by, and the overloaded words |
| [Creation modes](areas/creation-modes.md#12-mode-table) | Every way a story gets made, and which are live |
| [`collections.md`](collections.md) | Who reads and writes each Firestore collection, browser or server |
| [`status-audit.md`](status-audit.md) | Every status field, its values, and where they contradict |
| [`config-inventory.md`](config-inventory.md) | What is curated product content (kept across a reset) and how to export it |
| [`delete-list.md`](delete-list.md) | Dead and superseded code, with evidence |
| [`open-risks.md`](open-risks.md) | Security, billing and data-integrity problems for Phase 3 |
| `areas/*.md` | The six detailed maps, with file:line citations |

The area maps were produced by six parallel read-only reviews (creation modes, storybook
pipeline, characters & actors, print & orders, config & admin, clients). The cross-cutting
documents above consolidate them.

## The process today, in one paragraph

A parent signs up and adds children (and optionally characters) from the browser. A child picks
a **creation mode** (a `storyGenerator`) and the browser creates a `storySessions` document. The
mode's API route and Genkit flow run the conversation; for the beat engine the browser also writes
the transcript. The finished text lands in `stories/{sessionId}`, through `/api/storyCompile` for
some modes and written directly by the flow for others. The child then picks an output type and
art style, and a storybook document is created (by the API or directly by the browser). The open
browser tab drives generation: it calls the pages route, waits for `ready`, then calls the images
route; audio and character reference sheets run as unawaited background promises. A parent can
lay the book out for print (a `printStoryBooks` document, or the separate "printable" path),
place an order, and an admin manually approves and submits it to Mixam.

## Creation modes at a glance

| Mode | Status | Note |
|------|--------|------|
| Wizard ("Story Wizard"): parent, kids PWA, mobile variants | **Live**, the default | Never passes through compile; mobile runs every generator as the wizard |
| Gemini 3 ("Free Play") | Live | |
| Gemini 4 ("Guided Story") | Live | |
| Friends ("Fun with my friends") | Live | Never passes through compile |
| Beat / arc engine ("Choose Your Adventure") | Engine works; no chooser offers it | |
| Chat | URL-only | Runs the beat engine, stored as `chat` |
| Legacy warmup session | Diagnostic, linked from every story screen | Beat handling broken |
| Story arc engine | Admin test only | |
| `startStoryFlow`, `storyChatFlow`, `/kids/play`, `select-output-type` | Dead | |

## Headline findings

1. **There is no single model of the process.** Seven-plus creation modes each create
   sessions in their own shape (sessions are created in 8 client places plus one API route), and
   two of the live modes skip the compile step, so their stories lack synopsis, title, audio and
   group avatar jobs, and they are never charged against the story allowance.
2. **The browser is the orchestrator.** Core records (sessions, transcripts, storybooks,
   children, characters) are written from the client, and storybook generation only advances
   while a tab is open. Only the mobile app goes through the API for everything.
3. **"Storybook" has at least eight names**, and `bookId` means a story id on some routes and a
   storybook id on others. There are two print-edition models with two PDF generators.
4. **No shared status vocabulary.** "In progress" is `running`, `generating` or `in_progress`;
   locks are plain reads; a crash leaves a book stuck; a partly illustrated book is marked
   `error` and hidden from lists although it can be ordered.
5. **Configured settings don't always take effect.** Text-model selection at `/admin/ai-models`
   does nothing (flows hard-code models); the AI logging toggles do nothing; there are about seven
   on/off control planes and four model-selection sources.
6. **Character likeness is weaker than documented.** Canonical portraits are generated on every
   photo upload and used by nothing; reference sheets are built from `avatarUrl`, which may be a
   random stock photo.
7. **Ordering is not ready for real money.** No payment, our cost shown as the price, no
   idempotency on order creation or Mixam submission.
8. **Security gaps beyond Phase 0** were found: three were fixed in the Phase 0 follow-up PR, and the
   rest are listed in `open-risks.md` for Phase 3.

## Curated configuration

`scripts/export-config.mjs` exports every KEEP collection in `config-inventory.md`, with
subcollections, redacting secret-looking fields and listing the Storage files the config points
at (`--storage-dir` downloads them). Run it against production before any reset:

```bash
FIREBASE_SERVICE_ACCOUNT_KEY="$(gcloud secrets versions access latest --secret=FIREBASE_SERVICE_ACCOUNT_KEY)" \
  node scripts/export-config.mjs --out seed/config --storage-dir seed/storage
```

`seed/storage` holds binary files and should stay out of git (it is ignored); keep it somewhere
durable instead.

## Next: owner review

Phase 1 ends when the owner confirms that the glossary and the creation-mode catalogue match the
product as they know it, and decides which creation modes survive. Those answers feed Phase 2.
