import type { StoryType, StoryTypePromptConfig } from '@/lib/types';
import type { FormattedStoryContext } from '@/lib/story-context-builder';
import { generateEndingOutputDescription } from '@/lib/schemas/ending-output';

export type EndingPromptContext = {
  storyType: StoryType;
  formattedContext: FormattedStoryContext;
  childAge: number | null;
  childPreferenceSummary: string;
  levelBand?: string;
  useMessagesArray?: boolean;    // If true, story history is passed via messages parameter
  useSchemaOutput?: boolean;     // If true, omit OUTPUT REQUIREMENTS section (schema is passed separately)
  globalPrefix?: string;         // Optional global prefix to prepend to prompt
};

/**
 * Builds a structured prompt for ending generation.
 * Uses ONLY the StoryType for configuration - no hardcoded instructions.
 *
 * Prompt structure:
 * 1. OBJECTIVE - What to produce
 * 2. ROLE & IDENTITY - Who the AI is (from StoryType)
 * 3. STORY SUBJECT - Child, siblings, characters context
 * 4. YOUR TASK - Ending-specific instructions from storyType
 * 5. OUTPUT REQUIREMENTS - Schema-derived format (optional)
 */
export function buildEndingPrompt(ctx: EndingPromptContext): string {
  const { storyType, levelBand, useSchemaOutput } = ctx;

  // Resolve config with level band overrides
  const baseConfig = storyType.promptConfig;
  if (!baseConfig) {
    throw new Error(`StoryType "${storyType.id}" is missing promptConfig. Each story type must define its own prompt configuration.`);
  }

  const overrides = levelBand ? storyType.levelBandOverrides?.[levelBand] : undefined;
  const config = overrides ? { ...baseConfig, ...overrides } : baseConfig;

  const sections = [
    buildObjectiveSection(storyType),
    buildRoleSection(config),
    buildContextSection(ctx.formattedContext, ctx.childAge),
    buildTaskSection(config, ctx.childPreferenceSummary),
  ];

  // Only include OUTPUT REQUIREMENTS section if not using schema-based output
  // When using schema output, Genkit passes the schema to the model separately
  if (!useSchemaOutput) {
    sections.push(buildOutputRequirementsSection());
  }

  const prompt = sections.join('\n\n');

  // Prepend global prefix if provided
  if (ctx.globalPrefix) {
    return `${ctx.globalPrefix}\n\n${prompt}`;
  }

  return prompt;
}

/**
 * OBJECTIVE section - What the AI must produce
 */
function buildObjectiveSection(storyType: StoryType): string {
  return `=== OBJECTIVE ===
Generate three possible endings for "${storyType.name}".
${storyType.shortDescription}`;
}

/**
 * ROLE & IDENTITY section - Who the AI is for this story type
 */
function buildRoleSection(config: StoryTypePromptConfig): string {
  const rules = config.behaviorRules.map(r => `• ${r}`).join('\n');
  return `=== ROLE & IDENTITY ===
${config.roleDefinition}

Behavior Rules:
${rules}`;
}

/**
 * STORY SUBJECT section - Child, siblings, and characters context
 */
function buildContextSection(context: FormattedStoryContext, childAge: number | null): string {
  const ageDesc = childAge ? `${childAge} years old` : 'young (age unknown)';
  return `=== STORY SUBJECT ===
${context.fullContext}

The main child is ${ageDesc}.`;
}

/**
 * YOUR TASK section - Ending-specific instructions from storyType config
 */
function buildTaskSection(config: StoryTypePromptConfig, childPreferenceSummary: string): string {
  // Use endingInstructions from storyType if available, otherwise use a sensible default
  const instructions = config.endingInstructions ||
    'Based on the story conversation, generate three possible endings that feel satisfying and age-appropriate.';

  return `=== YOUR TASK ===
${instructions}

Child's Inspirations: ${childPreferenceSummary}`;
}

/**
 * OUTPUT REQUIREMENTS section - Schema-derived format specification
 * Only included when not using schema-based output
 */
function buildOutputRequirementsSection(): string {
  return `=== OUTPUT REQUIREMENTS ===
Return a single valid JSON object (no markdown, no explanation):
${generateEndingOutputDescription()}`;
}
