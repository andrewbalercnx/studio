# Target Domain Model

> Phase 2 of `../REVIEW_PLAN.md`. The entities the rebuilt system is made of, with one name each.
> Every type, collection, route and UI label uses these names. Where today's code uses another
> name, `../as-is/glossary.md` lists it; the rebuild retires it.

## The backbone: Story → Manuscript → Book

```
                  ┌──────────────┐  1     n ┌──────────────┐  1     n ┌──────────────┐
 Child + Cast ──▶ │    Story     │ ───────▶ │  Manuscript  │ ───────▶ │     Book     │ ──▶ PrintOrder
                  │ (A: created  │          │ (B: the words│          │ (C: how it   │
                  │  with child) │          │  in pages)   │          │  looks)      │
                  └──────────────┘          └──────────────┘          └──────────────┘
                  mode, transcript,         form, length, density,     style, layout, cast
                  text, cast                pages = text + scene       reference sheets,
                                            narration audio            page art, renders
```

| Stage | Entity | Decides | Generates | Fixed once created |
|-------|--------|---------|-----------|--------------------|
| A | **Story** | What happens, who is in it | Synopsis, title | Text and cast, once `complete` |
| B | **Manuscript** | The words as they will be read: form, reading level, length, density, page breaks | Page text and scene notes; narration audio | Length and density |
| C | **Book** | How it looks: art style, layout, front/back matter, print product | Cast reference sheets, page art, renders (screen and PDF) | Style and layout (a new look is a new Book) |

**The B ↔ C contract.** A Manuscript fixes the number of **story pages** and a **text density**.
A Book fixes the number of **physical pages** (story pages plus title page, dedication, end
pages, and padding to the print product's page multiple). Every Layout declares which lengths
and densities it supports; creating a Book only offers compatible layouts, so an incompatible
combination cannot be chosen. See ADR-0001.

## Entities

### People

| Entity | Collection | Owner | Notes |
|--------|------------|-------|-------|
| **Family** | `users/{uid}` | itself | The signed-in parent account. One account per family, as today. Roles: `parent` (default), `writer`, `admin` (token claims only) |
| **Child** | `children/{childId}` | `ownerUid` | A child in the family. Can be the active persona. Has a **Likeness** |
| **Character** | `characters/{characterId}` | `ownerUid` | Anyone else who can appear: family member, friend, pet, toy. `scope`: `family` or a `childId`. `origin`: `parent` or `story` (introduced by the AI during creation). Has a **Likeness** |

**Likeness** (embedded in Child and Character; ADR-0006):

| Field | From | Used for |
|-------|------|----------|
| `photos[]` | Parent uploads | Ground truth |
| `appearance` | Text description generated **from `photos` only** (CLAUDE.md rule) | Verbal anchor in every prompt |
| `portrait` | Canonical portrait generated from `photos` | Visual anchor for reference sheets |
| `avatar` | Generated from `portrait`, or uploaded | UI only; **never** fed to image generation as a likeness |
| `likenessJob` | Job state (see `pipeline.md`) | Progress |

There are no stock placeholder images. An entity with no photos has no portrait. Its reference
sheet is drawn from `appearance` alone, and the UI says so.

### Creation and content

| Entity | Collection | Notes |
|--------|------------|-------|
| **Story** | `stories/{storyId}` | Created when a child starts creating; replaces today's session *and* story (ADR-0004). `mode` (see `creation.md`), `childId`, `cast[]`, `status`, `text`, `title`, `synopsis` |
| Story turns | `stories/{storyId}/turns/{turnId}` | The creation conversation. **Written by the server only**: each turn is recorded by the route that produced it |
| **Manuscript** | `manuscripts/{manuscriptId}` | `storyId`, `form`, `readingLevel`, `length` (story pages), `density`, `status`, narration settings |
| Manuscript pages | `manuscripts/{id}/pages/{n}` | `text` (display names resolved), `scene` (`location`, `presentCast[]`, `action`), `narrationUrl` |
| **Book** | `books/{bookId}` | `manuscriptId`, `storyId`, `styleId`, `layoutId`, `printProductId?`, `status`, `art` rollup |
| Book pages | `books/{id}/pages/{n}` | `kind` (`cover`, `title`, `story`, `dedication`, `end`, `blank`, `back`), `manuscriptPage?`, `artUrl`, `artJob` |
| Cast sheets | `books/{id}/castSheets/{castId}` | Reference sheet for one cast member **in this Book's style**. Per Book, so two Books never overwrite each other |
| Renders | `books/{id}/renders/{renderId}` | Immutable: `medium` (`screen`, `print`), files, created at. A new render never overwrites an old one; orders pin a render |
| **ShareLink** | `shareLinks/{token}` | Points at a Book render; revoked when the Book is unlocked or deleted |
| **PrintOrder** | `printOrders/{orderId}` | `bookId`, `renderId` (pinned), `printProductId`, quantity, address, `status`, `payment`, Mixam fields. Written by the server only |

Top-level collections with an owner field, not deep nesting: "all my books" stays a simple
query, and every document is checked the same way.

### Cast

A Story has one cast list. No more `actors`, `supportingCharacterIds`, `friendsSelected…` or
`mainCharacterId`.

```ts
type CastMember = {
  castId: string;            // stable within the Story
  ref: { kind: 'child' | 'character'; id: string };
  role: 'hero' | 'supporting';
  addedBy: 'setup' | 'child' | 'ai';
};
```

Story text refers to cast members with one token format, `[[cast:<castId>]]`, parsed by one
module. Manuscript page text is stored with names already resolved (the words a child reads),
and each page's `scene.presentCast` lists who is on that page. Image prompts are built from
`presentCast`, not by scraping text. This is the world-state design from
`../../REFACTORING-TODOS.md`, folded into the model.

### Configuration (curated, survives resets)

| Entity | Collection | Replaces |
|--------|------------|----------|
| **CreationMode** | `creationModes/{modeId}` | `storyGenerators`, `systemConfig/kidsFlows` |
| **StoryType** | `storyTypes/{id}` | `storyTypes` (used by the beat mode), with prompts folded in from `promptConfigs` |
| **Form** | `forms/{formId}` | `storyOutputTypes`: `picture_book`, `poem`, `coloring_pages`, `audio_script`. Declares allowed lengths, default density, reading levels, the manuscript prompt |
| **Style** | `styles/{styleId}` | `imageStyles` (with its example images and scene exemplars) |
| **Layout** | `layouts/{layoutId}` | `printLayouts`. `medium` (`screen`, `print`), supported lengths and densities, page-kind boxes, linked print product |
| **PrintProduct** | `printProducts/{id}` | `printProducts` (Mixam spec, page rules) |
| **Product**, **Price** | `products`, `prices` | Unchanged commercial catalogue |
| **AIModels** | `config/aiModels` | One registry keyed by purpose (ADR-0008) |
| Other settings | `config/{name}` | `systemConfig/*`, split into config and runtime state |

## Ownership and access

- Every user-data document has **`ownerUid`**. The three names in use today (`parentUid`,
  `ownerParentUid`, `ownerUserId`) are retired.
- **The browser never writes user data** (ADR-0005). It reads its own documents directly, so
  progress updates stay live through Firestore listeners, and changes everything through API
  routes. Firestore rules become: owner may read; nobody but admins may write.
- Every route uses one guard that checks the token, ownership and persona, as Phase 0's
  `route-auth.server.ts` does. Server actions follow the same rule.

## What disappears

- `storySessions` (merged into Story), `children/{id}/sessions` (mirror), `storyBooks`,
  `stories/*/outputs`, `stories/*/storybooks` (now `books`), `printStoryBooks` (now a Book with a
  print Layout), `exemplars`, `storyPhases`, `promptConfigs` (folded into StoryType and
  CreationMode), `systemConfig/kidsFlows`.
- The words *storybook*, *output*, *printable* and *exemplar* in code (see the glossary).
