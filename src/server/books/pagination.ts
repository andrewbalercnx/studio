/**
 * Pagination for `manuscript.paginate`, ported from the storybookV2 pagination flow and
 * scene repair (both deleted in slice 5.2):
 *
 * - One model call producing every page's text, cast and scene (plus the cover
 *   scene), with a deliberately loose output schema.
 * - Up to 3 attempts at rising temperature (0.3, 0.7, 0.9) when the response is
 *   degenerate (no text pages, no usable scene, wrong page count) or misses the
 *   schema; each attempt decorrelates from the last.
 * - Deterministic scene repair (bad scene tags, missing actors/atmosphere) and
 *   scene continuity for pages the model left without a scene.
 * - The first description of a location becomes canonical for every page there.
 *
 * Differences from today, on purpose:
 * - The Manuscript fixes the page count (ADR-0001), so the result is fitted to
 *   exactly `length` pages (merge the shortest neighbours / split the longest
 *   page at a sentence) instead of whatever the model returned.
 * - No silent sentence-chunking fallback: a failed pagination fails the job
 *   (retried by the runner) and then the Manuscript.
 * - Page text is stored resolved (names, no tokens); `presentCast` lists cast
 *   ids, so image prompts never scrape text.
 */
import { z } from 'zod';
import type { Scene } from '../data/schemas/manuscript';
import { DENSITY_GUIDANCE, type Density, type Form } from '../catalog/forms';
import { castFor, displayText, narrationText, type Cast } from './cast';

// ---------------------------------------------------------------------------
// Model output (loose on purpose: see story-pagination-flow.ts)
// ---------------------------------------------------------------------------

const looseSceneSchema = z.object({
  locationKey: z.string().optional(),
  locationDescription: z.string().optional(),
  actors: z.array(z.object({ id: z.string(), action: z.string().optional(), facing: z.string().optional() })).optional(),
  atmosphere: z.string().optional(),
  sceneTag: z.string().optional(),
});
export type LooseScene = z.infer<typeof looseSceneSchema>;

export const paginationOutputSchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      text: z.string(),
      actors: z.array(z.string()),
      imageScene: looseSceneSchema.optional(),
    })
  ),
  cover: looseSceneSchema.optional(),
});
export type PaginationOutput = z.infer<typeof paginationOutputSchema>;

export type RawPage = { text: string; actors: string[]; scene: RepairedScene | null };

// ---------------------------------------------------------------------------
// Scene repair (ported from the deleted src/lib/image-scene-repair.ts)
// ---------------------------------------------------------------------------

export const SCENE_TAGS = ['indoor-day', 'outdoor-day', 'indoor-night', 'outdoor-night'] as const;
export type SceneTag = (typeof SCENE_TAGS)[number];

const DEFAULT_ATMOSPHERE: Record<SceneTag, string> = {
  'indoor-day': 'warm, bright daylight, cheerful indoor scene',
  'outdoor-day': 'bright, sunny, open-air and cheerful',
  'indoor-night': 'soft, cozy lamplight, calm night-time mood',
  'outdoor-night': 'gentle moonlight, calm and magical night air',
};
const NIGHT_WORDS = /night|moon|star|dark|bedtime|lamplight|twilight|dusk|evening/i;
const INDOOR_WORDS = /indoor|inside|interior|room|kitchen|bedroom|house|home|hall|school|classroom|library|cave|castle/i;
const OUTDOOR_WORDS = /outdoor|outside|exterior|garden|forest|park|beach|field|meadow|sky|street|mountain|sea|yard/i;

export function coerceSceneTag(rawTag: unknown, context: string): SceneTag {
  if (typeof rawTag === 'string' && (SCENE_TAGS as readonly string[]).includes(rawTag)) return rawTag as SceneTag;
  const haystack = `${typeof rawTag === 'string' ? rawTag : ''} ${context}`;
  const night = NIGHT_WORDS.test(haystack);
  const indoor = INDOOR_WORDS.test(haystack) && !OUTDOOR_WORDS.test(haystack);
  if (indoor && night) return 'indoor-night';
  if (indoor) return 'indoor-day';
  if (night) return 'outdoor-night';
  return 'outdoor-day';
}

export type RepairedScene = {
  locationKey: string;
  locationDescription: string;
  actors: Array<{ id: string; action: string }>;
  atmosphere: string;
  sceneTag: SceneTag;
};

/** Repair a loose scene, or null when it has nothing visual (no location description). */
export function repairScene(scene: LooseScene | undefined | null, pageActorIds: string[], pageNumber: number): RepairedScene | null {
  if (!scene || typeof scene !== 'object') return null;
  const locationDescription = scene.locationDescription?.trim() ?? '';
  const locationKey = scene.locationKey?.trim() || `scene-${pageNumber}`;
  let actors = (scene.actors ?? [])
    .filter((a) => a && typeof a.id === 'string' && a.id.trim())
    .map((a) => {
      const action = a.action?.trim() || 'in the scene';
      return { id: a.id.trim(), action: a.facing?.trim() ? `${action}, ${a.facing.trim()}` : action };
    });
  if (actors.length === 0 && pageActorIds.length > 0) actors = pageActorIds.map((id) => ({ id, action: 'in the scene' }));
  if (!locationDescription && !scene.locationKey?.trim()) return null;
  const sceneTag = coerceSceneTag(scene.sceneTag, `${locationDescription} ${scene.atmosphere ?? ''}`);
  return {
    locationKey,
    locationDescription,
    actors,
    atmosphere: scene.atmosphere?.trim() || DEFAULT_ATMOSPHERE[sceneTag],
    sceneTag,
  };
}

/** Scene continuity: a page without a scene inherits the nearest earlier one, with its own actors. */
export function fillMissingScenes(pages: RawPage[]): RawPage[] {
  const first = pages.find((p) => p.scene);
  if (!first) return pages;
  let last = first.scene!;
  return pages.map((page) => {
    if (page.scene) {
      last = page.scene;
      return page;
    }
    return {
      ...page,
      scene: { ...last, actors: page.actors.length > 0 ? page.actors.map((id) => ({ id, action: 'in the scene' })) : last.actors },
    };
  });
}

// ---------------------------------------------------------------------------
// Fitting to the Manuscript's length
// ---------------------------------------------------------------------------

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function splitText(text: string): [string, string] | null {
  const sentences = text.match(/[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sentences.length >= 2) {
    const total = text.length;
    let best = 1;
    let bestDistance = Infinity;
    let running = 0;
    for (let i = 1; i < sentences.length; i++) {
      running += sentences[i - 1].length;
      const distance = Math.abs(running - total / 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return [sentences.slice(0, best).join(' '), sentences.slice(best).join(' ')];
  }
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(' '), words.slice(middle).join(' ')];
}

/**
 * Make exactly `length` pages: merge the shortest adjacent pair while there are
 * too many; split the longest page while there are too few. Returns null when
 * the text is too short to fill `length` pages.
 */
export function fitPageCount(pages: RawPage[], length: number): RawPage[] | null {
  const result = pages.map((p) => ({ ...p, actors: [...p.actors] }));
  while (result.length > length) {
    let best = 0;
    for (let i = 1; i < result.length - 1; i++) {
      if (result[i].text.length + result[i + 1].text.length < result[best].text.length + result[best + 1].text.length) best = i;
    }
    const [a, b] = [result[best], result[best + 1]];
    result.splice(best, 2, {
      text: `${a.text.trim()} ${b.text.trim()}`,
      actors: union(a.actors, b.actors),
      scene: a.scene ? { ...a.scene, actors: [...a.scene.actors, ...(b.scene?.actors ?? []).filter((x) => !a.scene!.actors.some((y) => y.id === x.id))] } : b.scene,
    });
  }
  while (result.length < length) {
    let longest = -1;
    let split: [string, string] | null = null;
    const order = result.map((p, i) => i).sort((i, j) => result[j].text.length - result[i].text.length);
    for (const i of order) {
      split = splitText(result[i].text);
      if (split) {
        longest = i;
        break;
      }
    }
    if (longest < 0 || !split) return null;
    const page = result[longest];
    result.splice(longest, 1, { ...page, text: split[0] }, { ...page, text: split[1] });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export type PaginationPromptInput = {
  basePrompt: string;
  form: Pick<Form, 'paginationPrompt' | 'styleHint' | 'rhymes' | 'name'>;
  length: number;
  density: Density;
  cast: Cast;
  text: string;
  title: string | null;
  synopsis: string | null;
};

function castLine(member: Cast['members'][number]): string {
  const details = [
    member.role === 'hero' ? 'the main character' : null,
    member.characterType,
    member.description,
    member.likeness.appearance ? `Appearance: ${member.likeness.appearance}` : null,
  ].filter(Boolean);
  return `- ${member.castId}: ${member.displayName}${details.length ? ` — ${details.join('. ')}` : ''}`;
}

export function buildPaginationPrompt(input: PaginationPromptInput): string {
  const { form, cast } = input;
  const instructions = form.paginationPrompt
    ? `**OUTPUT TYPE SPECIFIC INSTRUCTIONS:**\n${form.paginationPrompt}\n\n**GENERAL PAGINATION INSTRUCTIONS:**\n${input.basePrompt}`
    : input.basePrompt;
  const tokenMapping = [...cast.tokenMap.entries()]
    .filter(([token]) => token)
    .map(([token, castId]) => `$$${token}$$ = ${castFor(cast, castId)?.displayName ?? castId} (id: ${castId})`)
    .join('\n');
  const required = cast.members.find((m) => m.role === 'hero');

  return `${instructions}

${form.styleHint ? `STYLE: ${form.styleHint}` : ''}
${form.rhymes ? 'IMPORTANT: This story has rhyming verse. Maintain the rhyme scheme across page breaks. Never split a rhyming couplet across two pages — if two lines rhyme, keep them together on the same page.' : ''}

**PAGE COUNT (Crucial):** Split the story into EXACTLY ${input.length} pages — no more, no fewer.
**TEXT DENSITY:** ${DENSITY_GUIDANCE[input.density]}

**CHARACTER REFERENCE (IDs for image generation — use these ids in "actors" and imageScene):**
${tokenMapping || 'No named characters.'}

**CHARACTER DETAILS (for context):**
${cast.members.map(castLine).join('\n') || 'No characters.'}
${input.title ? `\n**TITLE:** ${input.title}` : ''}${input.synopsis ? `\n**SYNOPSIS:** ${input.synopsis}` : ''}

**STORY TEXT TO PAGINATE:**
${input.text}

**OUTPUT FORMAT (Crucial):**
Return a JSON object with this exact structure:
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "The exact story text for this page (copy verbatim — do not rewrite)",
      "actors": ["actor-id-1", "actor-id-2"],
      "imageScene": {
        "locationKey": "kitchen",
        "locationDescription": "a cozy farmhouse kitchen with a round wooden table, yellow walls, and morning sunlight streaming through a checked curtain",
        "actors": [
          { "id": "actor-id-1", "action": "standing at the table, reaching for a cookie jar, eyes wide with excitement" }
        ],
        "atmosphere": "warm, bright morning light, cheerful and playful",
        "sceneTag": "indoor-day"
      }
    }
  ],
  "cover": {
    "locationKey": "short-label",
    "locationDescription": "the most visually compelling setting of the story",
    "actors": [ { "id": "actor-id-1", "action": "a dynamic, iconic cover pose and expression" } ],
    "atmosphere": "Cover composition: framing and focal point; character positions; mood and lighting",
    "sceneTag": "outdoor-day"
  }
}

IMPORTANT:
- pageNumber starts at 1 and increments sequentially, up to ${input.length}
- text is copied verbatim from the story — do NOT rewrite, summarise, or add content; keep every $$id$$ token exactly as written
- actors is an array of actor IDs (without the $$ markers) for ALL characters physically present on this page — include everyone visible in the scene, whether active, watching or reacting. Only exclude a character who is genuinely absent
- imageScene describes the illustration for this page:
  * locationKey: a short, consistent label for the setting. Use the EXACT same key for the same location across pages
  * locationDescription: a detailed visual description of the environment. For the FIRST use of a locationKey describe it fully; for later pages at the same locationKey use an empty string ("")
  * actors: EVERY character from the page's actors array — no more, no fewer — each with a vivid, specific action (observers: exactly how they watch or react)
  * atmosphere: mood, lighting, time of day and emotional tone
  * sceneTag: exactly one of indoor-day, outdoor-day, indoor-night, outdoor-night
- cover designs the FRONT COVER: the hero moment of the story, characters large and engaging${required ? `; it MUST include ${required.castId} (${required.displayName})` : ''}

Generate the paginated output now.`;
}

// ---------------------------------------------------------------------------
// From model output to Manuscript pages
// ---------------------------------------------------------------------------

/** Pages with text, repaired scenes and continuity applied. */
export function rawPagesFrom(output: PaginationOutput): RawPage[] {
  const sorted = output.pages.filter((p) => p.text && p.text.trim().length > 0).sort((a, b) => a.pageNumber - b.pageNumber);
  // The model describes a location once; later pages there leave it empty. Fill it in
  // before repair so a bad scene tag is coerced from the real place, not from nothing.
  const registry = new Map<string, string>();
  for (const page of sorted) {
    const key = page.imageScene?.locationKey?.trim();
    const description = page.imageScene?.locationDescription?.trim();
    if (key && description && !registry.has(key)) registry.set(key, description);
  }
  const pages = sorted.map((p, index) => {
    const actors = (p.actors ?? []).map((a) => a.replace(/\$/g, '').trim()).filter(Boolean);
    const key = p.imageScene?.locationKey?.trim();
    const scene =
      p.imageScene && key && !p.imageScene.locationDescription?.trim() && registry.has(key)
        ? { ...p.imageScene, locationDescription: registry.get(key) }
        : p.imageScene;
    return { text: p.text.trim(), actors, scene: repairScene(scene, actors, index + 1) };
  });
  return fillMissingScenes(pages);
}

/** Why a response should be retried at a higher temperature, or null when it is usable. */
export function degenerateReason(pages: RawPage[], length: number): string | null {
  if (pages.length === 0) return 'no non-empty text pages';
  if (!pages.some((p) => p.scene?.locationDescription)) return 'no text page has a usable scene';
  if (pages.length !== length) return `expected ${length} pages, got ${pages.length}`;
  return null;
}

function toScene(scene: RepairedScene | null, pageActors: string[], cast: Cast, location: string): Scene {
  const ids = (list: string[]) => [...new Set(list.map((id) => castFor(cast, id)?.castId).filter((id): id is string => !!id))];
  const actorEntries = (scene?.actors ?? pageActors.map((id) => ({ id, action: 'in the scene' })))
    .map((a) => ({ member: castFor(cast, a.id), action: a.action }))
    .filter((a): a is { member: NonNullable<ReturnType<typeof castFor>>; action: string } => !!a.member);
  const castActions: Scene['castActions'] = [];
  for (const entry of actorEntries) {
    if (!castActions.some((c) => c.castId === entry.member.castId)) {
      castActions.push({ castId: entry.member.castId, action: displayText(entry.action, cast) });
    }
  }
  const presentCast = ids([...pageActors, ...castActions.map((c) => c.castId)]);
  for (const castId of presentCast) {
    if (!castActions.some((c) => c.castId === castId)) castActions.push({ castId, action: 'in the scene' });
  }
  return {
    location: displayText(location, cast),
    presentCast,
    action: castActions.map((c) => `${cast.byId.get(c.castId)?.displayName ?? c.castId}: ${c.action}`).join('\n'),
    locationKey: scene?.locationKey ?? '',
    mood: displayText(scene?.atmosphere ?? '', cast),
    tag: scene?.sceneTag ?? '',
    castActions,
  };
}

export type ManuscriptPageData = { pageNumber: number; text: string; narrationText: string; scene: Scene };

/** Resolve names, apply canonical locations, number the pages. */
export function toManuscriptPages(pages: RawPage[], cast: Cast): ManuscriptPageData[] {
  const registry = new Map<string, string>();
  for (const page of pages) {
    if (page.scene?.locationKey && page.scene.locationDescription && !registry.has(page.scene.locationKey)) {
      registry.set(page.scene.locationKey, page.scene.locationDescription);
    }
  }
  return pages.map((page, index) => {
    const location =
      (page.scene && (registry.get(page.scene.locationKey) || page.scene.locationDescription || page.scene.locationKey)) || '';
    return {
      pageNumber: index + 1,
      text: displayText(page.text, cast),
      narrationText: narrationText(page.text, cast),
      scene: toScene(page.scene, page.actors, cast, location),
    };
  });
}

/** The cover scene: the model's, repaired, with the hero guaranteed; else the first page's place with the hero. */
export function coverScene(output: PaginationOutput | null, pages: ManuscriptPageData[], cast: Cast): Scene {
  const hero = cast.members.find((m) => m.role === 'hero');
  const repaired = repairScene(output?.cover, hero ? [hero.castId] : [], 0);
  if (repaired?.locationDescription) {
    const scene = toScene(repaired, [], cast, repaired.locationDescription);
    if (hero && !scene.presentCast.includes(hero.castId)) {
      scene.presentCast.unshift(hero.castId);
      scene.castActions.unshift({ castId: hero.castId, action: 'featured prominently, looking adventurous and inviting' });
      scene.action = `${hero.displayName}: featured prominently, looking adventurous and inviting\n${scene.action}`.trim();
    }
    return scene;
  }
  const first = pages[0]?.scene;
  const present = hero ? [hero.castId, ...(first?.presentCast ?? []).filter((id) => id !== hero.castId)] : first?.presentCast ?? [];
  const castActions = present.map((castId) => ({
    castId,
    action: castId === hero?.castId ? 'featured prominently, looking adventurous and inviting' : 'joining in, happy and excited',
  }));
  return {
    location: first?.location ?? 'a magical storybook world',
    presentCast: present,
    action: castActions.map((c) => `${cast.byId.get(c.castId)?.displayName ?? c.castId}: ${c.action}`).join('\n'),
    locationKey: first?.locationKey ?? 'cover',
    mood: 'Cover composition: characters large and centred, inviting and full of wonder',
    tag: first?.tag ?? 'outdoor-day',
    castActions,
  };
}

/** Deterministic pages for TEST_MODE: the story split into `length` pages, no model call. */
export function testModePages(text: string, length: number, cast: Cast): ManuscriptPageData[] {
  const source = text.trim() || 'Once upon a test, everything worked deterministically.';
  const everyone = cast.members.map((m) => m.castId);
  const seed: RawPage[] = [{ text: source, actors: everyone, scene: null }];
  let pages = fitPageCount(seed, length);
  if (!pages) {
    // Too few words: pad deterministically so the fixture always has `length` pages.
    pages = Array.from({ length }, (_, i) => ({ text: i === 0 ? source : `Test page ${i + 1}.`, actors: everyone, scene: null }));
  }
  return toManuscriptPages(
    pages.map((p) => ({
      ...p,
      scene: {
        locationKey: 'test-location',
        locationDescription: 'A bright test garden',
        actors: everyone.map((id) => ({ id, action: 'smiling at the reader' })),
        atmosphere: 'cheerful test light',
        sceneTag: 'outdoor-day',
      },
    })),
    cast
  );
}
