/**
 * Book "format": the shape a Book's pictures are drawn and shown at.
 *
 * A Book with a print Layout uses that layout's page aspect. A Book with no
 * layout is a *screen* Book, and screen Books use a portrait 4:5 — it reads
 * like a book on a phone or tablet held upright and crops cleanly toward common
 * print trims (≈ 8×10"), rather than the old square that prompted this change.
 *
 * This constant is the single source of truth, shared by the server (page-art
 * aspect, `artAspectRatio`) and the client (the reader's picture frame), so the
 * dimension art is generated at and the dimension it is displayed at never drift.
 */

/** Screen-Book picture aspect as the image model's ratio string. */
export const SCREEN_ASPECT_RATIO = '4:5';

/** Screen-Book picture aspect as a numeric width / height, for CSS and layout maths. */
export const SCREEN_ASPECT = 4 / 5;

/** A CSS `aspect-ratio` value (`"4 / 5"`) for a Book's picture frame. */
export function cssAspectRatio(aspect: number = SCREEN_ASPECT): string {
  return `${aspect} / 1`;
}
