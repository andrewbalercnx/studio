# ADR-0011: Picture-book lengths and who chooses

**Status**: Accepted (owner, 2026-10-29)

## Decision

- **Lengths**: a picture-book Manuscript has **12, 16 or 24 story pages**. The Book adds title,
  dedication and end pages and pads to the print product's rules (Mixam case binding: at least 24
  interior pages, in multiples of 4), so 12 and 16 story pages print as 24 pages and 24 as 28.
  Each Form stores its allowed lengths in config, so other Forms (poems, colouring pages) can have
  their own menus.
- **Who chooses**: when a story is finished, the **child** picks the Form (what kind of book) and
  the Style (how it looks). Length and density default from the Form. The **parent** picks the
  Layout and print product, and orders.

## Consequences

- The child-facing flow after a story is two visual choices; nothing about page counts or layouts.
- The parent can make further Books from the same Manuscript (another Style or Layout) without the
  child.
