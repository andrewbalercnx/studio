# ADR-0001: Story → Manuscript → Book

**Status**: Accepted (owner, 2026-10-29)

## Context

Today a "storybook" mixes three decisions: the words, how they are split into pages, and how
the result looks. Print adds a second, parallel model (`printStoryBooks` vs `finalization.printable*`).
Changing the art style means regenerating text; reference sheets are stored per story, so a second
book overwrites the first one's.

## Decision

Three stages, each a separate entity:

- **Story** (A): the text created with the child, and its cast.
- **Manuscript** (B, many per Story): the words as read: form (prose, poem…), reading level,
  number of **story pages**, text density, page breaks, per-page scene notes. Narration belongs here.
- **Book** (C, many per Manuscript): art style, Layout, front/back matter, physical page count,
  cast reference sheets, page art, renders. Screen reading is a Book with a screen Layout.

The contract between B and C is **length** (chosen from a menu the Form allows) and **density**
(picture-led, balanced, text-led). Every Layout declares the lengths and densities it supports;
Book creation only offers compatible Layouts.

## Why page count lives in B

In a picture book, page turns are story beats, so splitting text into pages is a writing decision.
What is genuinely layout (front/back matter, padding to the print product's page multiple, where
text sits, trim size) stays in C.

## Consequences

- Same words, several looks: a new Book reuses the Manuscript, its text and its narration.
- Restyling regenerates art only; moving text re-renders only.
- One edition model for screen and print; `printStoryBooks` and `storyBook/printable` go.
- Cost: an extra entity and an extra choice. The child-facing UI can default B's choices.

## Alternatives

- **Two stages (Story → Book, Book writes its own pages)**: simpler, but every new look pays to
  regenerate text, and "same words, different look" is lost.
- **Page count in C**: layouts could re-split text freely, but page turns would stop being
  authored, and C would have to re-run text generation.
