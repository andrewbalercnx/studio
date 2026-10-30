/**
 * Cast tokens: the one module that parses and renders `[[cast:<castId>]]`
 * (domain-model.md "Cast"). New code never matches `$$id$$` itself.
 *
 * - Stored Story text, turn prompts and options carry `[[cast:castId]]`.
 * - Model output is normalised with `normalizeModelText`: the model may answer
 *   with `[[cast:id]]`, today's `$$id$$`, the single-dollar fallback `$id$`
 *   (15+ id characters) or a display name inside a token; the caller resolves
 *   each raw token to a castId (owner-scoped) or rejects it.
 * - Curated prompts (storyGenerators) still say "use $$id$$ placeholders";
 *   `toCastTokenPrompt` rewrites those instructions to the new format so
 *   prompts and stored text agree.
 */

const CAST_TOKEN = /\[\[cast:([^\]\s]+)\]\]/g;
/** Any token form a model may emit, in priority order (target first). */
const MODEL_TOKEN_PATTERNS: RegExp[] = [CAST_TOKEN, /\$\$([^$\n]{1,80})\$\$/g, /\$([a-zA-Z0-9_-]{15,})\$/g];

/** Aliases models use for the hero (today's prompts contain `$$childId$$` literally). */
export const HERO_ALIASES = new Set(['childId', 'CHILD_ID_PLACEHOLDER', 'child-id', 'mainChildId']);

export function castToken(castId: string): string {
  return `[[cast:${castId}]]`;
}

/** castIds referenced by `[[cast:id]]` tokens, in order of first appearance. */
export function extractCastIds(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of (text ?? '').matchAll(CAST_TOKEN)) {
    const id = match[1].trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Replace every `[[cast:id]]` with `name(id)`; an unknown id reads as "a friend". */
export function renderCastTokens(text: string | null | undefined, name: (castId: string) => string | null | undefined): string {
  return (text ?? '').replace(CAST_TOKEN, (_match, id: string) => name(id.trim()) || 'a friend');
}

/** A raw token that is plainly a name ("Bramble"), not an id: kept as words when it resolves to nobody. */
function looksLikeName(raw: string): boolean {
  if (!raw.includes(' ') && raw.length >= 15) return false; // a Firestore-style id
  return /^[A-Za-z][A-Za-z' -]{0,39}$/.test(raw);
}

/**
 * Turn model output into stored text: every token form becomes
 * `[[cast:castId]]` when `resolve(raw)` knows it; otherwise a name-like token
 * is kept as plain words and an id-like one becomes "a friend" (never another
 * family's id).
 */
export function normalizeModelText(text: string | null | undefined, resolve: (raw: string) => string | null): string {
  let result = text ?? '';
  const placeholders: string[] = [];
  for (const pattern of MODEL_TOKEN_PATTERNS) {
    result = result.replace(pattern, (_match, raw: string) => {
      const trimmed = raw.trim();
      const castId = resolve(trimmed);
      const replacement = castId ? castToken(castId) : looksLikeName(trimmed) ? trimmed : 'a friend';
      // Park resolved tokens so later patterns cannot match inside them.
      placeholders.push(replacement);
      return `\u0000${placeholders.length - 1}\u0000`;
    });
  }
  return result.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => placeholders[Number(i)]);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Put tokens back where a model wrote display names (e.g. a polish step that
 * resolved them). Whole words only, longest names first, never inside an
 * existing token.
 */
export function tokenizeNames(text: string, people: Array<{ castId: string; displayName: string }>): string {
  const named = people
    .filter((p) => p.displayName.trim().length > 1)
    .sort((a, b) => b.displayName.length - a.displayName.length);
  if (named.length === 0) return text;
  const parts = text.split(/(\[\[cast:[^\]\s]+\]\])/g);
  return parts
    .map((part) => {
      if (part.startsWith('[[cast:')) return part;
      let out = part;
      const parked: string[] = [];
      for (const person of named) {
        const pattern = new RegExp(`(?<![\\w])${escapeRegExp(person.displayName.trim())}(?![\\w])`, 'g');
        out = out.replace(pattern, () => {
          parked.push(castToken(person.castId));
          return `\u0000${parked.length - 1}\u0000`;
        });
      }
      return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => parked[Number(i)]);
    })
    .join('');
}

/**
 * Curated prompts written for today's `$$id$$` placeholders, rewritten to the
 * `[[cast:id]]` format (`$$childId$$` → `[[cast:childId]]`, which the
 * resolver maps to the hero). The instruction's intent is unchanged.
 */
export function toCastTokenPrompt(prompt: string): string {
  return prompt.replace(/\$\$([^$\s]{1,60})\$\$/g, (_m, inner: string) => castToken(inner));
}
