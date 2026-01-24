/**
 * Replace character/child names with their $$id$$ placeholders in text.
 *
 * This allows users to write natural instructions like:
 * "The child on this page is Nymira"
 *
 * Which gets converted to:
 * "The child on this page is $$childId$$"
 *
 * The placeholder format is used consistently throughout the image generation
 * pipeline to reference specific characters.
 */

export type ActorNameMapping = {
  id: string;
  displayName: string;
};

/**
 * Replaces actor display names with their $$id$$ placeholders.
 *
 * @param text - The text to process (e.g., additional instructions)
 * @param actors - Array of actors with id and displayName
 * @returns The text with names replaced by $$id$$ placeholders
 *
 * @example
 * const actors = [
 *   { id: 'abc123', displayName: 'Nymira' },
 *   { id: 'def456', displayName: 'Captain Whiskers' }
 * ];
 * replaceNamesWithPlaceholders('Show Nymira smiling', actors);
 * // Returns: 'Show $$abc123$$ smiling'
 */
export function replaceNamesWithPlaceholders(
  text: string,
  actors: ActorNameMapping[]
): string {
  if (!text || !actors || actors.length === 0) {
    return text;
  }

  let result = text;

  // Sort actors by displayName length (longest first) to avoid partial replacements
  // e.g., "Captain Whiskers" should be replaced before "Captain"
  const sortedActors = [...actors].sort(
    (a, b) => b.displayName.length - a.displayName.length
  );

  for (const actor of sortedActors) {
    if (!actor.displayName || !actor.id) continue;

    // Create a case-insensitive regex that matches the display name as a whole word
    // Use word boundaries to avoid partial matches (e.g., "Nymira" shouldn't match "Nymiras")
    // But also handle names at the start/end of strings and next to punctuation
    const escapedName = escapeRegExp(actor.displayName);
    const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');

    result = result.replace(regex, `$$${actor.id}$$`);
  }

  return result;
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if any actor names are found in the text.
 * Useful for providing feedback to users about what will be replaced.
 *
 * @param text - The text to check
 * @param actors - Array of actors with id and displayName
 * @returns Array of actor names found in the text
 */
export function findActorNamesInText(
  text: string,
  actors: ActorNameMapping[]
): string[] {
  if (!text || !actors || actors.length === 0) {
    return [];
  }

  const foundNames: string[] = [];

  for (const actor of actors) {
    if (!actor.displayName) continue;

    const escapedName = escapeRegExp(actor.displayName);
    const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');

    if (regex.test(text)) {
      foundNames.push(actor.displayName);
    }
  }

  return foundNames;
}
