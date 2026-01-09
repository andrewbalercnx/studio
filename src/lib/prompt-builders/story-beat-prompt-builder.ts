import type { StoryType, StoryTypePromptConfig, ArcStep } from '@/lib/types';
import type { FormattedStoryContext } from '@/lib/story-context-builder';
import { generateStoryBeatOutputDescription } from '@/lib/schemas/story-beat-output';

export type StoryBeatPromptContext = {
  storyType: StoryType;
  formattedContext: FormattedStoryContext;
  childAge: number | null;
  arcStep: ArcStep;
  arcProgress: number;           // 0.0 to 1.0
  storySoFar?: string;           // Optional - only used when not using messages array
  childPreferenceSummary: string;
  levelBand?: string;
  useMessagesArray?: boolean;    // If true, omit STORY SO FAR section (it will be passed via messages)
  globalPrefix?: string;         // Optional global prefix to prepend to prompt
  useSchemaOutput?: boolean;     // If true, omit OUTPUT REQUIREMENTS section (schema is passed separately)
  newlyIntroducedCharactersContext?: string; // Characters introduced during this story session
};

/**
 * Builds a structured prompt for story beat generation.
 * Uses ONLY the StoryType for configuration - no fallback to PromptConfig.
 *
 * Prompt structure:
 * 1. OBJECTIVE - What to produce
 * 2. ROLE & IDENTITY - Who the AI is (from StoryType)
 * 3. STORY SUBJECT - Child, siblings, characters context
 * 4. CURRENT BEAT - Arc step, progress, guidance
 * 5. NARRATIVE GUIDANCE - Style, themes, instructions
 * 6. STORY SO FAR - Previous content
 * 7. OUTPUT REQUIREMENTS - Schema-derived format
 */
export function buildStoryBeatPrompt(ctx: StoryBeatPromptContext): string {
  const { storyType, levelBand, useMessagesArray, useSchemaOutput } = ctx;

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
    buildCurrentBeatSection(storyType, ctx.arcStep, ctx.arcProgress),
    buildNarrativeGuidanceSection(config, ctx.childPreferenceSummary),
  ];

  // Add newly introduced characters section if there are any
  const newlyIntroducedContext = ctx.formattedContext.newlyIntroducedCharactersContext;
  if (newlyIntroducedContext) {
    sections.push(buildNewlyIntroducedCharactersSection(newlyIntroducedContext));
  }

  // Only include STORY SO FAR section if not using messages array
  // When using messages array, the conversation history is passed separately
  if (!useMessagesArray && ctx.storySoFar !== undefined) {
    sections.push(buildStorySoFarSection(ctx.storySoFar));
  }

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
Generate the next story beat for "${storyType.name}".
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

/** Format age for display. Handles 0 (babies under 1) correctly. */
function formatAgeDesc(childAge: number | null): string {
  if (childAge === null) return 'young (age unknown)';
  if (childAge === 0) return 'under 1 year old (a baby)';
  return `${childAge} years old`;
}

/**
 * STORY SUBJECT section - Child, siblings, and characters context
 */
function buildContextSection(context: FormattedStoryContext, childAge: number | null): string {
  const ageDesc = formatAgeDesc(childAge);
  return `=== STORY SUBJECT ===
${context.fullContext}

The main child is ${ageDesc}.`;
}

/**
 * CURRENT BEAT section - Arc step, progress, and step-specific guidance
 */
function buildCurrentBeatSection(storyType: StoryType, arcStep: ArcStep, progress: number): string {
  const pct = Math.round(progress * 100);
  const progressGuidance = getProgressGuidance(progress);

  let section = `=== CURRENT BEAT ===
Story Type: ${storyType.name}
Arc Step: ${arcStep.id} (${arcStep.label})
Story Progress: ${pct}%`;

  if (arcStep.guidance) {
    section += `\n\nStep Guidance: ${arcStep.guidance}`;
  }

  if (progressGuidance) {
    section += `\n${progressGuidance}`;
  }

  // Add character creation guidance when the arc step suggests it
  if (arcStep.suggestsNewCharacter) {
    section += `\n\n=== CHARACTER INTRODUCTION OPPORTUNITY ===
This story beat is an excellent opportunity to introduce a NEW character!
• At least ONE of the three options should introduce a new character (set introducesCharacter: true)
• Think about what kind of character would enrich the story at this point:
  - A helpful friend or guide who can aid the protagonist
  - A quirky companion with unique abilities or knowledge
  - A magical creature or talking animal
  - A wise mentor figure
• When introducing a character, provide:
  - newCharacterName: A proper name (e.g., "Bramble", "Captain Whiskers", "Luna")
  - newCharacterLabel: A descriptive phrase about who they are (e.g., "a wise old owl who knows all the forest secrets")
  - newCharacterType: Family, Friend, Pet, Toy, or Other
• The name and label must be DIFFERENT - the name is what to call them, the label describes who they are`;
  }

  return section;
}

/**
 * NEWLY INTRODUCED CHARACTERS section - Characters the child introduced during this story
 * Encourages the AI to continue featuring these characters prominently
 */
function buildNewlyIntroducedCharactersSection(charactersContext: string): string {
  return `=== NEWLY INTRODUCED STORY CHARACTERS ===
The following characters were introduced BY THE CHILD during this story session. These are special characters that the child chose to add to their story, so they should continue to play an important role:

${charactersContext}

IMPORTANT: Continue to feature these newly introduced characters in the story! The child specifically chose to add them, so:
• Include them in the story continuation when narratively appropriate
• Reference them by their $$id$$ placeholder (e.g., $$abc123$$)
• Give them actions, dialogue, or presence that advances the plot
• Consider including options that involve these characters`;
}

/**
 * Returns progress-based guidance for story pacing
 */
function getProgressGuidance(progress: number): string {
  if (progress > 0.7) {
    return `\nIMPORTANT: Story is ${Math.round(progress * 100)}% complete. Guide toward a satisfying conclusion. Include options that lead to resolution.`;
  }
  if (progress > 0.5) {
    return `\nSTORY PROGRESSION: Begin setting up for the climax and resolution.`;
  }
  if (progress > 0.3) {
    return `\nSTORY PROGRESSION: Continue developing the plot while keeping momentum.`;
  }
  return '';
}

/**
 * NARRATIVE GUIDANCE section - Style, themes, and story beat instructions
 */
function buildNarrativeGuidanceSection(config: StoryTypePromptConfig, prefs: string): string {
  const themes = config.thematicElements.map(t => `• ${t}`).join('\n');
  return `=== NARRATIVE GUIDANCE ===
Style: ${config.narrativeStyle}
Pacing: ${config.pacing}
Emotional Tone: ${config.emotionalTone}

Themes:
${themes}

Child's Inspirations: ${prefs}

Instructions:
${config.storyBeatInstructions}`;
}

/**
 * STORY SO FAR section - Previous story content
 */
function buildStorySoFarSection(storySoFar: string): string {
  if (!storySoFar?.trim()) {
    return `=== STORY SO FAR ===
(This is the beginning of the story)`;
  }
  return `=== STORY SO FAR ===
${storySoFar}`;
}

/**
 * OUTPUT REQUIREMENTS section - Schema-derived format specification
 */
function buildOutputRequirementsSection(): string {
  return `=== OUTPUT REQUIREMENTS ===
Return a single valid JSON object (no markdown, no explanation):
${generateStoryBeatOutputDescription()}`;
}
