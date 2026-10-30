/**
 * Gemini models Google has shut down, mapped to their replacements.
 *
 * Model names also come from Firestore (systemConfig/aiModels, config/aiModels,
 * storyGenerators.defaultModel, storyTypes promptConfig), where an old value
 * would keep pointing at a model that returns 404. Every reader passes the
 * name through `currentModelId`.
 *
 * Replacements are the newest stable (non-preview) models the Gemini API
 * lists. There is no stable Pro model; Flash replaces Pro too.
 */
export const CURRENT_TEXT_MODEL = 'googleai/gemini-3.8-flash';
export const CURRENT_IMAGE_MODEL = 'googleai/gemini-3.1-flash-image';

const RETIRED: Record<string, string> = {
  'gemini-1.5-pro': CURRENT_TEXT_MODEL,
  'gemini-1.5-flash': CURRENT_TEXT_MODEL,
  'gemini-2.0-flash': CURRENT_TEXT_MODEL,
  'gemini-2.0-flash-001': CURRENT_TEXT_MODEL,
  'gemini-2.5-pro': CURRENT_TEXT_MODEL,
  'gemini-2.5-flash': CURRENT_TEXT_MODEL,
  'gemini-2.5-flash-lite': CURRENT_TEXT_MODEL,
  'gemini-2.5-flash-image': CURRENT_IMAGE_MODEL,
  'gemini-2.5-flash-image-preview': CURRENT_IMAGE_MODEL,
};

/** The model to call for `name`: its replacement if Google retired it, else `name`. */
export function currentModelId(name: string): string;
export function currentModelId(name: string | undefined | null): string | undefined;
export function currentModelId(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const base = name.replace(/^(googleai|vertexai)\//, '');
  return RETIRED[base] ?? name;
}
