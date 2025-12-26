/**
 * Migration script to add promptConfig to existing StoryType documents.
 *
 * This script migrates StoryTypes from the legacy PromptConfig system
 * to the new embedded promptConfig structure.
 *
 * Run this script from an admin context after deploying the new code.
 */

import type { StoryType, StoryTypePromptConfig, PromptConfig } from '@/lib/types';
import type { Firestore } from 'firebase-admin/firestore';

/**
 * Default prompt config used when no legacy PromptConfig is found
 */
const defaultPromptConfig: StoryTypePromptConfig = {
  roleDefinition: "You are a gentle storyteller guiding a young child through a magical adventure. You speak in warm, simple language filled with wonder.",
  behaviorRules: [
    "Always use placeholder IDs ($$id$$) for characters - never include display names",
    "Never introduce scary or threatening elements",
    "Keep sentences short and rhythmic for young listeners",
    "Include sensory details that bring the story to life"
  ],
  narrativeStyle: "Warm and cozy with gentle wonder",
  thematicElements: ["Friendship", "Kindness", "Small adventures"],
  pacing: "moderate",
  emotionalTone: "gentle",
  storyBeatInstructions: "Continue the story with gentle pacing. Each beat should include a small discovery or interaction. End each beat with exactly 3 choices for the child.",
  warmupInstructions: "Engage the child in friendly conversation to understand their mood and preferences.",
  endingInstructions: "Bring the story to a cozy, satisfying conclusion with warmth and contentment.",
  model: {
    name: "googleai/gemini-2.5-pro",
    temperature: 0.7,
    maxOutputTokens: 10000
  }
};

/**
 * Extracts role definition from legacy systemPrompt
 */
function extractRoleFromSystemPrompt(systemPrompt: string): string {
  // Try to find the first sentence or paragraph that defines who the AI is
  const roleMatch = systemPrompt.match(/^[^.!?]+[.!?]/);
  if (roleMatch) {
    return roleMatch[0].trim();
  }
  // Fallback: return first 200 chars
  return systemPrompt.slice(0, 200).trim();
}

/**
 * Extracts behavior rules from legacy systemPrompt
 */
function extractRulesFromSystemPrompt(systemPrompt: string): string[] {
  const rules: string[] = [];

  // Look for bullet points or numbered lists
  const bulletMatches = systemPrompt.match(/[•\-*]\s*[^\n]+/g);
  if (bulletMatches) {
    rules.push(...bulletMatches.map(m => m.replace(/^[•\-*]\s*/, '').trim()));
  }

  // Add standard rules if we didn't find any
  if (rules.length === 0) {
    rules.push(
      "Always use placeholder IDs ($$id$$) for characters",
      "Never introduce scary or threatening elements",
      "Keep language simple and age-appropriate"
    );
  }

  return rules;
}

/**
 * Infers narrative style from story type metadata
 */
function inferNarrativeStyle(storyType: StoryType): string {
  const tags = storyType.tags || [];

  if (tags.includes('gentle') || tags.includes('calm')) {
    return "Warm and cozy with gentle wonder";
  }
  if (tags.includes('silly') || tags.includes('funny')) {
    return "Playful and giggly with lots of fun surprises";
  }
  if (tags.includes('adventure')) {
    return "Exciting but safe, full of discovery and wonder";
  }
  if (tags.includes('bedtime')) {
    return "Soft and soothing, perfect for winding down";
  }

  return "Warm, engaging, and filled with wonder";
}

/**
 * Infers emotional tone from story type metadata
 */
function inferEmotionalTone(storyType: StoryType): 'gentle' | 'playful' | 'adventurous' | 'calm' {
  const tags = storyType.tags || [];

  if (tags.includes('silly') || tags.includes('funny') || tags.includes('play')) {
    return 'playful';
  }
  if (tags.includes('adventure') || tags.includes('exploration')) {
    return 'adventurous';
  }
  if (tags.includes('bedtime') || tags.includes('calm')) {
    return 'calm';
  }

  return 'gentle';
}

/**
 * Infers pacing from story type metadata
 */
function inferPacing(storyType: StoryType): 'slow' | 'moderate' | 'fast' {
  const tags = storyType.tags || [];

  if (tags.includes('bedtime') || tags.includes('calm')) {
    return 'slow';
  }
  if (tags.includes('silly') || tags.includes('adventure')) {
    return 'moderate';
  }

  return 'moderate';
}

export interface MigrationResult {
  storyTypeId: string;
  status: 'migrated' | 'skipped' | 'error';
  message: string;
}

/**
 * Migrates a single StoryType to include promptConfig
 */
export async function migrateStoryType(
  firestore: Firestore,
  storyType: StoryType,
  legacyPromptConfig?: PromptConfig
): Promise<MigrationResult> {
  // Skip if already has promptConfig
  if (storyType.promptConfig) {
    return {
      storyTypeId: storyType.id,
      status: 'skipped',
      message: 'Already has promptConfig'
    };
  }

  try {
    let newPromptConfig: StoryTypePromptConfig;

    if (legacyPromptConfig) {
      // Build from legacy PromptConfig
      newPromptConfig = {
        roleDefinition: extractRoleFromSystemPrompt(legacyPromptConfig.systemPrompt),
        behaviorRules: extractRulesFromSystemPrompt(legacyPromptConfig.systemPrompt),
        narrativeStyle: inferNarrativeStyle(storyType),
        thematicElements: storyType.tags || ['Friendship', 'Kindness'],
        pacing: inferPacing(storyType),
        emotionalTone: inferEmotionalTone(storyType),
        storyBeatInstructions: legacyPromptConfig.modeInstructions || defaultPromptConfig.storyBeatInstructions,
        warmupInstructions: defaultPromptConfig.warmupInstructions,
        endingInstructions: defaultPromptConfig.endingInstructions,
        model: {
          name: legacyPromptConfig.model?.name || 'googleai/gemini-2.5-pro',
          temperature: legacyPromptConfig.model?.temperature ?? 0.7,
          maxOutputTokens: legacyPromptConfig.model?.maxOutputTokens ?? 10000
        }
      };
    } else {
      // Use default with story type inference
      newPromptConfig = {
        roleDefinition: defaultPromptConfig.roleDefinition,
        behaviorRules: [...defaultPromptConfig.behaviorRules],
        narrativeStyle: inferNarrativeStyle(storyType),
        thematicElements: storyType.tags || [...defaultPromptConfig.thematicElements],
        pacing: inferPacing(storyType),
        emotionalTone: inferEmotionalTone(storyType),
        storyBeatInstructions: defaultPromptConfig.storyBeatInstructions,
        warmupInstructions: defaultPromptConfig.warmupInstructions,
        endingInstructions: defaultPromptConfig.endingInstructions,
        model: {
          name: defaultPromptConfig.model.name,
          temperature: defaultPromptConfig.model.temperature,
          maxOutputTokens: defaultPromptConfig.model.maxOutputTokens
        }
      };
    }

    // Update the document
    const docRef = firestore.collection('storyTypes').doc(storyType.id);
    await docRef.update({
      promptConfig: newPromptConfig,
      version: 1,
      updatedAt: new Date()
    });

    return {
      storyTypeId: storyType.id,
      status: 'migrated',
      message: legacyPromptConfig ? 'Migrated from legacy PromptConfig' : 'Created from defaults'
    };
  } catch (error: any) {
    return {
      storyTypeId: storyType.id,
      status: 'error',
      message: error.message || 'Unknown error'
    };
  }
}

/**
 * Migrates all StoryTypes in the database
 */
export async function migrateAllStoryTypes(firestore: Firestore): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];

  // Load all story types
  const storyTypesSnapshot = await firestore.collection('storyTypes').get();
  const storyTypes = storyTypesSnapshot.docs.map(doc => ({
    ...doc.data(),
    id: doc.id
  } as StoryType));

  // Load legacy prompt configs for reference
  const promptConfigsSnapshot = await firestore.collection('promptConfigs').get();
  const promptConfigMap = new Map<string, PromptConfig>();
  promptConfigsSnapshot.docs.forEach(doc => {
    const config = doc.data() as PromptConfig;
    promptConfigMap.set(doc.id, config);
  });

  // Migrate each story type
  for (const storyType of storyTypes) {
    // Try to find matching legacy config
    const legacyConfigId = `story_beat_level_low_v1`;
    const legacyConfig = promptConfigMap.get(legacyConfigId);

    const result = await migrateStoryType(firestore, storyType, legacyConfig);
    results.push(result);

    console.log(`[${result.status}] ${result.storyTypeId}: ${result.message}`);
  }

  return results;
}

/**
 * Summary of migration results
 */
export function summarizeMigrationResults(results: MigrationResult[]): {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
} {
  return {
    total: results.length,
    migrated: results.filter(r => r.status === 'migrated').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length
  };
}
