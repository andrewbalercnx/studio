import type { StoryGenerator } from '@/lib/types';

/**
 * Presentation layer for the story-method chooser (server-first).
 *
 * The `storyGenerators` collection stores internal/admin-facing names like
 * "Gemini Free" and admin-oriented descriptions. A UX probe found that
 * exposing model jargon to end users with no guidance was a real activation
 * blocker ("five similar options with no hint which to pick").
 *
 * This module converts raw generator docs into a user-safe view:
 * - model jargon is hidden (per-id overrides + a generic scrub fallback);
 * - internal fields (prompts, model config, endpoints) are stripped;
 * - exactly one generator is flagged `recommended` so clients can render a
 *   "Recommended for first-timers" badge.
 *
 * Internal identifiers (`id` like 'gemini3') are kept — clients route on them
 * — but are never rendered to users.
 */

/** User-safe generator view returned by /api/kids-generators. */
export type KidsGeneratorView = {
  id: string;
  name: string;
  description: string;
  order?: number;
  capabilities?: StoryGenerator['capabilities'];
  styling?: {
    gradient?: string;
    darkGradient?: string;
    icon?: string;
    loadingMessage?: string;
  };
  /** True for exactly one generator: the best default for first-time users. */
  recommended: boolean;
};

/**
 * Optional admin-configurable presentation fields on a generator doc.
 * (Not part of the canonical StoryGenerator type; read defensively.)
 */
type GeneratorPresentationFields = {
  kidFriendlyName?: string;
  kidFriendlyDescription?: string;
  recommendedForKids?: boolean;
};

/**
 * Kid/parent-friendly copy for the built-in generators whose stored
 * names/descriptions contain model or implementation jargon.
 */
const PRESENTATION_OVERRIDES: Record<string, { name?: string; description?: string; loadingMessage?: string }> = {
  wizard: {
    name: 'Story Wizard',
    description: 'Answer four quick questions and watch a whole story appear. The simplest way to make your first story.',
  },
  gemini3: {
    name: 'Free Play',
    description: 'Make the story up as you go — open-ended questions where anything can happen!',
    loadingMessage: 'Crafting your story...',
  },
  gemini4: {
    name: 'Guided Story',
    description: 'Build your story step by step with friendly questions about the setting, characters and adventure.',
  },
  beat: {
    name: 'Choose Your Adventure',
    description: 'Pick a story style, then shape the tale one turn at a time.',
  },
  friends: {
    name: 'Fun with my friends',
    description: 'Star in an adventure with your favourite characters and friends. Choose your companions, pick a scenario, and watch your story come to life!',
  },
};

/** Model/vendor jargon that must never reach an end user. */
const MODEL_JARGON = /\b(gemini|gpt[-\s]?[\w.]*|claude|anthropic|openai|llama|palm|vertex|genkit|llm|ai model)\b/gi;

const FALLBACK_NAME = 'Story Adventure';

/** Strip model jargon from a free-text label; tidy leftover whitespace/punctuation. */
export function scrubModelJargon(text: string, fallback = ''): string {
  const scrubbed = text
    .replace(MODEL_JARGON, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '')
    .trim();
  return scrubbed || fallback;
}

/** True when a label still contains model/vendor jargon. */
export function containsModelJargon(text: string): boolean {
  MODEL_JARGON.lastIndex = 0;
  return MODEL_JARGON.test(text);
}

function presentName(gen: StoryGenerator & GeneratorPresentationFields): string {
  if (gen.kidFriendlyName?.trim()) return gen.kidFriendlyName.trim();
  const override = PRESENTATION_OVERRIDES[gen.id]?.name;
  if (override) return override;
  return scrubModelJargon(gen.name || '', FALLBACK_NAME);
}

function presentDescription(gen: StoryGenerator & GeneratorPresentationFields): string {
  if (gen.kidFriendlyDescription?.trim()) return gen.kidFriendlyDescription.trim();
  const override = PRESENTATION_OVERRIDES[gen.id]?.description;
  if (override) return override;
  return scrubModelJargon(gen.description || '');
}

function presentLoadingMessage(gen: StoryGenerator): string | undefined {
  const raw = gen.styling?.loadingMessage;
  const override = PRESENTATION_OVERRIDES[gen.id]?.loadingMessage;
  if (override) return override;
  if (!raw) return raw;
  return containsModelJargon(raw) ? scrubModelJargon(raw, 'Creating your story...') : raw;
}

/**
 * Picks the generator to badge as "Recommended for first-timers".
 * Priority: admin flag (`recommendedForKids`) → the wizard (fixed four
 * questions, always finishes with a complete story — the lowest-friction
 * first run) → the first generator in display order.
 */
function pickRecommendedId(generators: (StoryGenerator & GeneratorPresentationFields)[]): string | null {
  if (generators.length === 0) return null;
  const adminPick = generators.find(g => g.recommendedForKids === true);
  if (adminPick) return adminPick.id;
  const wizard = generators.find(g => g.id === 'wizard');
  if (wizard) return wizard.id;
  return generators[0].id;
}

/** Sort by order (lower first), then by id for stability. */
export function sortGenerators<T extends { id: string; order?: number }>(generators: T[]): T[] {
  return [...generators].sort((a, b) => {
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Convert raw generator docs into the user-safe, sorted view served to
 * clients. Strips internal fields (prompts, model config, endpoints),
 * hides model jargon, and flags exactly one generator as recommended.
 */
export function presentGeneratorsForKids(rawGenerators: StoryGenerator[]): KidsGeneratorView[] {
  const generators = sortGenerators(rawGenerators as (StoryGenerator & GeneratorPresentationFields)[]);
  const recommendedId = pickRecommendedId(generators);

  return generators.map((gen) => ({
    id: gen.id,
    name: presentName(gen),
    description: presentDescription(gen),
    ...(gen.order !== undefined && { order: gen.order }),
    ...(gen.capabilities && { capabilities: gen.capabilities }),
    styling: {
      ...(gen.styling?.gradient && { gradient: gen.styling.gradient }),
      ...(gen.styling?.darkGradient && { darkGradient: gen.styling.darkGradient }),
      ...(gen.styling?.icon && { icon: gen.styling.icon }),
      ...(presentLoadingMessage(gen) && { loadingMessage: presentLoadingMessage(gen) }),
    },
    recommended: gen.id === recommendedId,
  }));
}
