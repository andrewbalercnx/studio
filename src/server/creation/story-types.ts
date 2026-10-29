/**
 * StoryType config for the `adventure` mode, read from today's `storyTypes`
 * collection (domain-model.md: StoryType keeps its name; prompts already live
 * on it as `promptConfig`). `promptConfig.model` is not honoured: models are
 * chosen by purpose (ADR-0008); temperature and token limits are.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { ArcStep, StoryTypePromptConfig } from '@/lib/types';

export const STORY_TYPES_COLLECTION = 'storyTypes';

export type StoryTypeConfig = {
  storyTypeId: string;
  name: string;
  shortDescription: string;
  status: 'live' | 'draft';
  ageFrom: number | null;
  ageTo: number | null;
  arcSteps: ArcStep[];
  promptConfig: StoryTypePromptConfig | null;
  levelBandOverrides: Record<string, Partial<StoryTypePromptConfig>>;
};

/** Arc steps stored as plain strings (older documents) become `{ id, label }`. */
export function normalizeArcSteps(steps: unknown): ArcStep[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step): ArcStep | null => {
      if (typeof step === 'string' && step.trim()) {
        return { id: step, label: step.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
      }
      if (step && typeof step === 'object' && typeof (step as ArcStep).id === 'string') {
        const s = step as ArcStep;
        return { id: s.id, label: s.label || s.id, guidance: s.guidance, suggestsNewCharacter: s.suggestsNewCharacter === true };
      }
      return null;
    })
    .filter((s): s is ArcStep => !!s);
}

function asPromptConfig(raw: unknown): StoryTypePromptConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const config = raw as Partial<StoryTypePromptConfig>;
  if (typeof config.roleDefinition !== 'string') return null;
  return {
    roleDefinition: config.roleDefinition,
    behaviorRules: Array.isArray(config.behaviorRules) ? config.behaviorRules.filter((r) => typeof r === 'string') : [],
    narrativeStyle: config.narrativeStyle ?? '',
    thematicElements: Array.isArray(config.thematicElements) ? config.thematicElements.filter((t) => typeof t === 'string') : [],
    pacing: config.pacing ?? 'moderate',
    emotionalTone: config.emotionalTone ?? 'gentle',
    warmupInstructions: config.warmupInstructions,
    storyBeatInstructions: config.storyBeatInstructions ?? '',
    endingInstructions: config.endingInstructions,
    model: { name: config.model?.name ?? '', temperature: config.model?.temperature, maxOutputTokens: config.model?.maxOutputTokens },
  };
}

export function storyTypeFromDocument(storyTypeId: string, raw: Record<string, unknown>): StoryTypeConfig {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    storyTypeId,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : storyTypeId,
    shortDescription: typeof raw.shortDescription === 'string' ? raw.shortDescription : '',
    status: raw.status === 'live' ? 'live' : 'draft',
    ageFrom: num(raw.ageFrom),
    ageTo: num(raw.ageTo),
    arcSteps: normalizeArcSteps((raw.arcTemplate as { steps?: unknown } | undefined)?.steps),
    promptConfig: asPromptConfig(raw.promptConfig),
    levelBandOverrides:
      raw.levelBandOverrides && typeof raw.levelBandOverrides === 'object'
        ? (raw.levelBandOverrides as Record<string, Partial<StoryTypePromptConfig>>)
        : {},
  };
}

export async function loadStoryType(db: Firestore, storyTypeId: string): Promise<StoryTypeConfig | null> {
  if (!storyTypeId || storyTypeId.includes('/')) return null;
  const snapshot = await db.collection(STORY_TYPES_COLLECTION).doc(storyTypeId).get();
  return snapshot.exists ? storyTypeFromDocument(snapshot.id, snapshot.data() ?? {}) : null;
}

/** Live StoryTypes suitable for a child of `age` (null = any), by name. */
export async function listStoryTypesForAge(db: Firestore, age: number | null): Promise<StoryTypeConfig[]> {
  const snapshot = await db.collection(STORY_TYPES_COLLECTION).where('status', '==', 'live').get();
  return snapshot.docs
    .map((doc) => storyTypeFromDocument(doc.id, doc.data()))
    .filter((t) => age === null || ((t.ageFrom === null || age >= t.ageFrom) && (t.ageTo === null || age <= t.ageTo)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
