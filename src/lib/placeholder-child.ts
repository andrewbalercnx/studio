/**
 * Placeholder child-profile detection.
 *
 * Historically, signup auto-seeded a "My First Child" placeholder profile.
 * That seeding has been removed (signup now prompts the parent to add their
 * first child explicitly), but existing accounts may still carry the
 * placeholder. Those profiles must never be pulled into story casts —
 * a UX probe found the dummy child leaking into a real child's story as a
 * character ("Ezra and My First Child are about to start a grand adventure").
 *
 * Use `isPlaceholderChild` wherever sibling/cast lists are assembled
 * (server-side: story context builder, friends flow).
 */

/** Display name given to the legacy auto-seeded profile at signup. */
export const LEGACY_PLACEHOLDER_DISPLAY_NAME = 'My First Child';

const PLACEHOLDER_NAMES = new Set([
  LEGACY_PLACEHOLDER_DISPLAY_NAME.toLowerCase(),
]);

type PlaceholderCheckable = {
  displayName?: string | null;
  /** Optional explicit flag, in case placeholder profiles are ever marked. */
  isPlaceholder?: boolean;
};

/**
 * Returns true when a child profile is a placeholder (auto-seeded dummy)
 * rather than a real child the parent created.
 */
export function isPlaceholderChild(child: PlaceholderCheckable | null | undefined): boolean {
  if (!child) return false;
  if (child.isPlaceholder === true) return true;
  const name = (child.displayName ?? '').trim().toLowerCase();
  return PLACEHOLDER_NAMES.has(name);
}

/**
 * Filters a list of child profiles down to real (non-placeholder, non-deleted)
 * children suitable for story casts.
 */
export function excludePlaceholderChildren<T extends PlaceholderCheckable & { deletedAt?: unknown }>(
  children: T[]
): T[] {
  return children.filter(child => !isPlaceholderChild(child) && !child.deletedAt);
}
