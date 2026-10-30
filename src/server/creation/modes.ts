/**
 * CreationMode config (domain-model.md "Configuration"): an adapter over
 * today's `storyGenerators` collection until the config re-seed moves it to
 * `creationModes`. Mode ids are the target ids; the documents keep their
 * current ids:
 *
 *   wizard    ← storyGenerators/wizard
 *   freeplay  ← storyGenerators/gemini3
 *   guided    ← storyGenerators/gemini4
 *   friends   ← storyGenerators/friends
 *   adventure ← storyGenerators/beat
 *
 * Exposed: prompts (by today's keys), the `creation.text` model override
 * (`defaultModel`, ADR-0008: the only model a mode may pick), temperatures,
 * presentation (through the jargon-scrubbing presentation layer the chooser
 * uses), `status` and `enabledForKids`.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { presentGeneratorsForKids } from '@/lib/kids-generator-presentation';
import type { StoryGenerator } from '@/lib/types';
import { CREATION_MODE_IDS, type CreationModeId } from '../data/schemas/story';

export const MODE_SOURCE_IDS: Record<CreationModeId, string> = {
  wizard: 'wizard',
  freeplay: 'gemini3',
  guided: 'gemini4',
  friends: 'friends',
  adventure: 'beat',
};

export const STORY_GENERATORS_COLLECTION = 'storyGenerators';

export function modeIdForSource(sourceId: string): CreationModeId | null {
  const entry = Object.entries(MODE_SOURCE_IDS).find(([, source]) => source === sourceId);
  return entry ? (entry[0] as CreationModeId) : null;
}

export type CreationModePresentation = {
  name: string;
  description: string;
  icon: string | null;
  gradient: string | null;
  darkGradient: string | null;
  loadingMessage: string | null;
  order: number | null;
  recommended: boolean;
};

export type CreationMode = {
  modeId: CreationModeId;
  /** The `storyGenerators` document it is read from. */
  sourceId: string;
  status: 'live' | 'draft' | 'archived';
  enabledForKids: boolean;
  /** Prompt templates by today's keys (e.g. `questionGeneration`, `systemPrompt`, `phase_opening`). Missing = the engine's default. */
  prompts: Record<string, string>;
  /** `creation.text` model override (ADR-0008); null = the registry's model. */
  model: string | null;
  /** Default temperature for the mode's calls; null = each call's own default. */
  temperature: number | null;
  /** Per-prompt temperatures (today's `promptConfig[key].temperature`). Per-prompt models are not honoured (ADR-0008). */
  promptTemperatures: Record<string, number>;
  presentation: CreationModePresentation;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Map one `storyGenerators` document (data, id) to a CreationMode. */
export function creationModeFromGenerator(
  modeId: CreationModeId,
  sourceId: string,
  raw: Record<string, unknown>,
  presentation?: Partial<CreationModePresentation>
): CreationMode {
  const prompts: Record<string, string> = {};
  if (raw.prompts && typeof raw.prompts === 'object') {
    for (const [key, value] of Object.entries(raw.prompts as Record<string, unknown>)) {
      const text = str(value);
      if (text) prompts[key] = text;
    }
  }
  const promptTemperatures: Record<string, number> = {};
  if (raw.promptConfig && typeof raw.promptConfig === 'object') {
    for (const [key, value] of Object.entries(raw.promptConfig as Record<string, unknown>)) {
      const temperature = num((value as { temperature?: unknown } | null)?.temperature);
      if (temperature !== null) promptTemperatures[key] = temperature;
    }
  }
  const status = raw.status === 'live' || raw.status === 'archived' ? raw.status : 'draft';
  const view = presentGeneratorsForKids([{ ...(raw as unknown as StoryGenerator), id: sourceId }])[0];
  return {
    modeId,
    sourceId,
    status,
    enabledForKids: raw.enabledForKids === true,
    prompts,
    // A target-shaped `model` wins over today's `defaultModel` (re-seeded documents read the same way).
    model: str(raw.model) ?? str(raw.defaultModel),
    temperature: num(raw.defaultTemperature),
    promptTemperatures,
    presentation: {
      name: view.name,
      description: view.description,
      icon: view.styling?.icon ?? null,
      gradient: view.styling?.gradient ?? null,
      darkGradient: view.styling?.darkGradient ?? null,
      loadingMessage: view.styling?.loadingMessage ?? null,
      order: view.order ?? null,
      recommended: false,
      ...presentation,
    },
  };
}

/** The mode's config, or null when its document does not exist. */
export async function loadCreationMode(db: Firestore, modeId: CreationModeId): Promise<CreationMode | null> {
  const sourceId = MODE_SOURCE_IDS[modeId];
  const snapshot = await db.collection(STORY_GENERATORS_COLLECTION).doc(sourceId).get();
  if (!snapshot.exists) return null;
  return creationModeFromGenerator(modeId, sourceId, snapshot.data() ?? {});
}

/** Every surviving mode that has a config document, in display order, with `recommended` set on one. */
export async function listCreationModes(db: Firestore): Promise<CreationMode[]> {
  const snapshots = await Promise.all(
    CREATION_MODE_IDS.map((modeId) => db.collection(STORY_GENERATORS_COLLECTION).doc(MODE_SOURCE_IDS[modeId]).get())
  );
  const raws = snapshots
    .map((snapshot, i) => ({ snapshot, modeId: CREATION_MODE_IDS[i] }))
    .filter(({ snapshot }) => snapshot.exists);
  const views = presentGeneratorsForKids(
    raws.map(({ snapshot }) => ({ ...(snapshot.data() as StoryGenerator), id: snapshot.id }))
  );
  return views.map((view) => {
    const { snapshot, modeId } = raws.find((r) => r.snapshot.id === view.id)!;
    return creationModeFromGenerator(modeId, snapshot.id, snapshot.data() ?? {}, { recommended: view.recommended });
  });
}

export type ModeAvailability = { ok: true } | { ok: false; code: 'MODE_NOT_LIVE' | 'MODE_NOT_FOR_KIDS'; message: string };

/**
 * Whether a mode may be started: it must be `live` (admins and writers may use
 * drafts, as with Forms), and a child persona only gets modes enabled for kids.
 */
export function modeAvailability(mode: CreationMode, options: { privileged: boolean; childPersona: boolean }): ModeAvailability {
  if (mode.status !== 'live' && !options.privileged) {
    return { ok: false, code: 'MODE_NOT_LIVE', message: 'This way of making a story is not available.' };
  }
  if (options.childPersona && !mode.enabledForKids && !options.privileged) {
    return { ok: false, code: 'MODE_NOT_FOR_KIDS', message: 'This way of making a story is not available for children.' };
  }
  return { ok: true };
}

/** Temperature for one prompt: per-prompt → mode default → the call's own default. */
export function temperatureFor(mode: CreationMode, promptKey: string, fallback: number): number {
  return mode.promptTemperatures[promptKey] ?? mode.temperature ?? fallback;
}
