/**
 * Deterministic repair of AI-paginated image scenes.
 *
 * gemini-2.5-flash stochastically violates the strict ImageScene shape in
 * small, mechanical ways (invalid sceneTag value, missing actors/atmosphere).
 * Rejecting the whole pagination over one such miss collapses the book to the
 * sentence-chunking fallback (no scenes at all), which is strictly worse than
 * repairing the field. Repairs here are conservative and derive only from
 * content the model itself produced for the page.
 */

import type { ImageScene } from '@/lib/types';

export const VALID_SCENE_TAGS = [
  'indoor-day',
  'outdoor-day',
  'indoor-night',
  'outdoor-night',
] as const;
export type SceneTag = (typeof VALID_SCENE_TAGS)[number];

const DEFAULT_ATMOSPHERE: Record<SceneTag, string> = {
  'indoor-day': 'warm, bright daylight, cheerful indoor scene',
  'outdoor-day': 'bright, sunny, open-air and cheerful',
  'indoor-night': 'soft, cozy lamplight, calm night-time mood',
  'outdoor-night': 'gentle moonlight, calm and magical night air',
};

const NIGHT_WORDS = /night|moon|star|dark|bedtime|lamplight|twilight|dusk|evening/i;
const INDOOR_WORDS = /indoor|inside|interior|room|kitchen|bedroom|house|home|hall|school|classroom|library|cave|castle/i;
const OUTDOOR_WORDS = /outdoor|outside|exterior|garden|forest|park|beach|field|meadow|sky|street|mountain|sea|yard/i;

/** Coerce an arbitrary model-emitted tag (or absent tag) onto the valid enum. */
export function coerceSceneTag(
  rawTag: unknown,
  contextText: string,
): SceneTag {
  if (typeof rawTag === 'string' && (VALID_SCENE_TAGS as readonly string[]).includes(rawTag)) {
    return rawTag as SceneTag;
  }
  // Derive from whatever the model did say: the bad tag itself plus the
  // scene's descriptive text.
  const haystack = `${typeof rawTag === 'string' ? rawTag : ''} ${contextText}`;
  const night = NIGHT_WORDS.test(haystack);
  const indoor = INDOOR_WORDS.test(haystack) && !OUTDOOR_WORDS.test(haystack);
  if (indoor && night) return 'indoor-night';
  if (indoor) return 'indoor-day';
  if (night) return 'outdoor-night';
  return 'outdoor-day';
}

export type LooseImageScene = {
  locationKey?: unknown;
  locationDescription?: unknown;
  actors?: unknown;
  atmosphere?: unknown;
  sceneTag?: unknown;
};

/**
 * Repair a loosely-validated scene into the strict ImageScene shape, or
 * return undefined when there is nothing usable to repair (no location
 * information at all) — downstream image generation has a no-scene fallback.
 */
export function repairImageScene(
  scene: LooseImageScene | undefined | null,
  pageActorIds: string[],
  pageNumber: number,
): ImageScene | undefined {
  if (!scene || typeof scene !== 'object') return undefined;

  const locationDescription =
    typeof scene.locationDescription === 'string' && scene.locationDescription.trim()
      ? scene.locationDescription.trim()
      : '';
  if (!locationDescription) return undefined; // nothing visual to draw from

  const locationKey =
    typeof scene.locationKey === 'string' && scene.locationKey.trim()
      ? scene.locationKey.trim()
      : `scene-${pageNumber}`;

  const rawActors = Array.isArray(scene.actors) ? scene.actors : [];
  let actors = rawActors
    .filter((a: any) => a && typeof a === 'object' && typeof a.id === 'string' && a.id.trim())
    .map((a: any) => ({
      id: a.id.trim(),
      action: typeof a.action === 'string' && a.action.trim() ? a.action.trim() : 'in the scene',
      ...(typeof a.facing === 'string' && a.facing.trim() ? { facing: a.facing.trim() } : {}),
    }));
  if (actors.length === 0 && pageActorIds.length > 0) {
    actors = pageActorIds.map((id) => ({ id, action: 'in the scene' }));
  }

  const sceneTag = coerceSceneTag(
    scene.sceneTag,
    `${locationDescription} ${typeof scene.atmosphere === 'string' ? scene.atmosphere : ''}`,
  );

  const atmosphere =
    typeof scene.atmosphere === 'string' && scene.atmosphere.trim()
      ? scene.atmosphere.trim()
      : DEFAULT_ATMOSPHERE[sceneTag];

  return { locationKey, locationDescription, actors, atmosphere, sceneTag };
}
