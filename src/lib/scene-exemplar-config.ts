/**
 * Scene exemplar configuration: defines the 4 canonical scene types used as
 * style references during page image generation.
 *
 * Defaults are hardcoded here. Admins can override via systemConfig/sceneExemplars
 * in Firestore (each entry matched by tag).
 */

export type SceneExemplarDefinition = {
  tag: string;
  label: string;
  /** Short description shown to the pagination AI when assigning a sceneTag to each page */
  description: string;
  /** Full image generation prompt — stored for re-generation; not passed to pagination AI */
  generationPrompt: string;
};

export const SCENE_EXEMPLAR_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'] as const;
export type SceneExemplarTag = typeof SCENE_EXEMPLAR_TAGS[number];

export const DEFAULT_SCENE_EXEMPLAR_DEFINITIONS: SceneExemplarDefinition[] = [
  {
    tag: 'indoor-day',
    label: 'Cozy interior daytime',
    description: 'Interior scenes in daylight or morning — homes, bedrooms, kitchens, playrooms with warm natural light',
    generationPrompt:
      'A bright kitchen or playroom in warm morning sunlight. A young child sits at a table; a friendly dog waits at their feet; a toy car sits on the floor. Sunlight streams through a window casting soft shadows. Colourful, domestic, cheerful.',
  },
  {
    tag: 'outdoor-day',
    label: 'Bright outdoor daytime',
    description: 'Outdoor scenes in daylight — parks, gardens, streets, open landscapes with bright natural light',
    generationPrompt:
      'Two children cycling along a sunny park path. A rabbit watches from the grass beside the path; a small bird perches on a fence post. Blue sky with fluffy clouds, open green landscape, colourful flowers. Joyful and energetic.',
  },
  {
    tag: 'indoor-night',
    label: 'Cozy interior nighttime',
    description: 'Interior scenes at night or bedtime — lamp-lit rooms, moonlit bedrooms, soft warm artificial light',
    generationPrompt:
      'A cosy bedroom at night, a warm bedside lamp casting a golden glow. A child reads in bed, a cat curled at their feet. Moonlight through curtains. Plush animals on a shelf. Calm, sleepy, safe.',
  },
  {
    tag: 'outdoor-night',
    label: 'Magical outdoor nighttime',
    description: 'Outdoor scenes at night or twilight — gardens, forests, starlit paths, magical spaces with cool moonlight',
    generationPrompt:
      'A child and their dog stand in a garden under a star-filled sky, looking up in wonder. An owl watches from a branch above. A bicycle leans against a fence in the middle distance. Fireflies glow. Cool blues and purples with warm accent light. Magical.',
  },
];
