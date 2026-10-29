# Target Creation Model

> Phase 2 of `../REVIEW_PLAN.md`. How a child and the AI create a Story, whatever the mode.
> Today: 7+ modes, sessions created in 8 browser code paths plus one API route, two modes that
> skip compile (`../as-is/areas/creation-modes.md`).

## Modes that survive (owner decision, 2026-10-29)

| Mode id | Name | Shape of the conversation |
|---------|------|---------------------------|
| `wizard` | Story Wizard | A few multiple-choice questions, then the AI writes the whole story |
| `freeplay` | Free Play | Open conversation (today's `gemini3`) |
| `guided` | Guided Story | Structured step-by-step conversation that can introduce characters (today's `gemini4`) |
| `friends` | Fun with my friends | Pick characters → scenario → synopsis → story |
| `adventure` | Choose Your Adventure | Beats along a StoryType's arc, A–D choices, a chosen ending (today's beat engine) |

Retired: Chat (ran the beat engine under another name), the legacy warmup session, the
standalone arc engine test route, `startStoryFlow`, `storyChatFlow`.

Each mode is a **CreationMode** config document (prompts, models, presentation, which children
see it) plus one server implementation of the interface below. Mode ids are stable; today's
`gemini3` / `gemini4` names are presentation-neutral replacements.

## The interface

```ts
interface CreationModeEngine {
  /** Called once when the Story is created. Returns the first prompt for the child. */
  start(ctx: StoryContext): Promise<Turn>;

  /** Called for each child input. Returns the next prompt, or `done` with the final text. */
  respond(ctx: StoryContext, input: ChildInput): Promise<Turn | Done>;
}

type ChildInput =
  | { kind: 'choice'; optionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'castPick'; castIds: string[] };

type Turn = {
  prompt: string;              // with [[cast:id]] tokens
  options?: { id: string; text: string }[];
  addCast?: NewCastMember[];   // characters the AI introduces
  progress?: { step: number; of?: number };
};

type Done = { kind: 'done'; text: string; titleHint?: string };
```

`StoryContext` is built once, by one module: the Story, its cast with likenesses, the child's
profile and preferences, the mode config, and the StoryType for `adventure`.

## One route, one flow of control

| Route | Does |
|-------|------|
| `POST /api/stories` | Create a Story: `{ childId, modeId, castIds? }`. Checks the child is the caller's, the mode is live for that child, and the story allowance is available. Calls `start`; records the first turn |
| `POST /api/stories/{id}/turns` | Child input. Guard: owner and persona. Calls `respond`; records the input and the reply as turns. On `done`, writes `text`, sets `finishing`, enqueues `story.finish` |
| `POST /api/stories/{id}/abandon` | Stop creating |

Mode-specific routes (`/api/storyWizard`, `/api/gemini3`, `/api/gemini4`, `/api/storyFriends`,
`/api/storyBeat`, `/api/storyEnding`, `/api/storyCompile`, `/api/warmupReply`…) are replaced by
these three. Web, kids PWA and mobile call the same routes, so a child gets the same mode
whichever client they use. Today mobile runs every mode as the wizard.

## What every mode gets for free

- Story created and turns recorded by the server, in one shape.
- Cast handling: AI-introduced characters become `characters` with `origin: 'story'` and join
  the Story's cast in the same write.
- The same ending: `finishing` → `story.finish` (title, synopsis, allowance) → `complete`.
- Persona scope, ownership and allowance checks in one place.
- The AI harness: model resolved by purpose, retries, tracing, logging (ADR-0008).

## After creation

A `complete` Story offers "Make a book": choose a Form (picture book, poem…), then a length and
density allowed by that Form → Manuscript. Then choose a Style and a compatible Layout → Book.
The child-facing UI can collapse these into one or two choices with sensible defaults; the
model keeps them separate so a second book from the same story reuses the Manuscript.
