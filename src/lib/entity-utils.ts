/** Extract all $$id$$ and $id$ entity placeholder IDs from text. Canonical implementation shared across all flows. */
export function extractEntityIds(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const doubleMatches = [...text.matchAll(/\$\$([a-zA-Z0-9_-]+)\$\$/g)];
  doubleMatches.forEach(m => ids.add(m[1]));
  const singleMatches = [...text.matchAll(/\$([a-zA-Z0-9_-]{15,})\$/g)];
  singleMatches.forEach(m => ids.add(m[1]));
  return [...ids];
}
