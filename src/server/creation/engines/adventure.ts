/**
 * `adventure` — Choose Your Adventure (port of today's beat engine:
 * src/ai/flows/story-beat-flow.ts + ending-flow.ts + story-text-compile-flow.ts,
 * with the prompt builders in src/lib/prompt-builders).
 *
 *   start           pick a StoryType (unless one was given at creation)   → choice
 *   choice          story type → beat for arc step 0                       → choice (A–C)
 *   choice          advance the arc; next beat, or after the last step     → three endings (A–C)
 *   choice          an ending → the beats + ending polished into one story → done
 *
 * The arc position, world state (who is present, where) and the beats live in
 * `modeState`; the browser no longer advances `arcStepIndex` or writes the
 * transcript. Beat options may introduce a character (created with the turn)
 * or point at an existing one. StoryType `promptConfig` drives the prompts as
 * today; its `model.name` is not honoured (ADR-0008: creation.text), its
 * temperature and token limit are. A StoryType without `promptConfig` uses the
 * shared storyteller message (today's legacy `promptConfigs` fallback is retired).
 *
 * modeState: { phase, storyTypeId, arcStepIndex, worldState, lastOptions, endings }.
 */
import { z } from 'zod';
import type { MessageData } from 'genkit';
import type { ArcStep, StoryTypePromptConfig } from '@/lib/types';
import { compilePromptConfig } from '../../config/definitions';
import { ConflictError } from '../../errors';
import { displayText, formatStoryContext, normalizeText, type StoryContext } from '../context';
import type { ChildInput, CreationModeEngine, Done, EngineDeps, NewCastMember, Turn } from '../engine';
import type { StoryTypeConfig } from '../story-types';
import { castToken, extractCastIds, tokenizeNames } from '../tokens';
import { introduceFromOption } from './freeplay';
import { addExistingToCast, ageWords, chosenOption, generate, inputNotExpected, storySystemMessage, turnWords, withPrefix } from './shared';

/** Port of src/lib/schemas/story-beat-output.ts. */
const beatOptionSchema = z.object({
  id: z.string().describe("A single uppercase letter: 'A', 'B', or 'C'"),
  text: z.string().describe('A short, child-friendly choice for what happens next'),
  introducesCharacter: z.boolean().optional().describe('Set to true if this option introduces a new character'),
  newCharacterName: z.string().optional().describe("The character's proper name (e.g., 'Nutsy', 'Captain Sparkle')"),
  newCharacterLabel: z.string().optional().describe("A descriptive phrase (e.g., 'a friendly squirrel who loves acorns')"),
  newCharacterType: z.enum(['Family', 'Friend', 'Pet', 'Toy', 'Other']).optional().describe('The type of character being introduced'),
  existingCharacterId: z.string().optional().describe('If referencing an existing character, their id'),
});

const beatSchema = z.object({
  storyContinuation: z.string().describe('The next paragraph of the story, continuing from the story so far'),
  scene: z
    .object({
      presentActors: z.array(z.string()).describe("Ids of ALL characters present during THIS beat. Always include the main child's id."),
      location: z.string().optional().describe("Where this scene takes place (e.g., 'the garden')"),
    })
    .describe('Scene state for this beat — who is present and where.'),
  options: z.array(beatOptionSchema).min(3).max(3).describe('Exactly 3 choices for the child'),
});

const endingSchema = z.object({
  endings: z
    .array(z.object({ id: z.string().describe("A single uppercase letter: 'A', 'B', or 'C'"), text: z.string().describe('Two to three short sentences providing a gentle, happy ending') }))
    .min(3)
    .max(3),
});

const compileSchema = z.object({ storyText: z.string().min(50), synopsis: z.string().min(10) });

/** Today's default when a StoryType has no arc steps. */
const DEFAULT_ARC_STEP: ArcStep = { id: 'introduce_character', label: 'Introduce Character' };
/** A StoryType without arc steps ends after this many beats (today it never ended on its own). */
export const STEPLESS_BEATS = 6;
const CONTEXT_WINDOW = 8;

type WorldState = { presentCastIds: string[]; location: string | null };

/** Default polish instructions (today's DEFAULT_COMPILE_INSTRUCTIONS, keeping cast tokens instead of names). */
export const DEFAULT_COMPILE_INSTRUCTIONS = `You are a master storyteller who specializes in polishing story text into a beautifully written narrative for a very young child (age 3-5). The story must be gentle, warm, and safe, with very short, simple sentences. It must be written in the third person. The final text should read like a classic, calm picture-book narrative.

**Your Task:**
You will be given a DRAFT STORY TEXT that was assembled from story beats. Your job is to:
1. Polish and smooth the text so it flows naturally as a single, coherent story
2. Fix any awkward transitions between sections
3. Ensure consistent tone and style throughout
4. Keep the story faithful to the original - do not add new plot points or characters
5. Write a brief synopsis (1-2 sentences, maximum 30 words) suitable for a parent to read`;

const TOKEN_KEEP_RULE = `**Character References (overrides anything above):**
Keep every character token such as ${castToken('abc123')} exactly as written in the draft. Do not replace tokens with names, and refer to every character listed below only by their token.`;

// ---------------------------------------------------------------------------
// Prompt builder (port of src/lib/prompt-builders/story-beat-prompt-builder.ts)
// ---------------------------------------------------------------------------

function progressGuidance(progress: number): string {
  const pct = Math.round(progress * 100);
  if (progress > 0.7) return `\nSTORY PROGRESSION: Story is ${pct}% complete. Guide urgently toward a satisfying conclusion — options should lead to resolution and closure.`;
  if (progress > 0.5) return `\nSTORY PROGRESSION: Story is ${pct}% complete. Begin setting up for the climax and resolution.`;
  if (progress > 0.3) return `\nSTORY PROGRESSION: Story is ${pct}% complete. Continue developing the plot while keeping momentum.`;
  return '';
}

function roleSection(config: StoryTypePromptConfig): string {
  return `=== ROLE & IDENTITY ===\n${config.roleDefinition}\n\nBehavior Rules:\n${config.behaviorRules.map((r) => `• ${r}`).join('\n')}`;
}

function contextSection(ctx: StoryContext): string {
  return `=== STORY SUBJECT ===\n${formatStoryContext(ctx).fullContext}\n\nThe main child is ${ageWords(ctx.childAge)}.\n\nRefer to every character only with their token, e.g. ${castToken(ctx.hero.castId)}.`;
}

function currentBeatSection(type: StoryTypeConfig, step: ArcStep, progress: number): string {
  let section = `=== CURRENT BEAT ===
Story Type: ${type.name}
Arc Step: ${step.id} (${step.label})
Story Progress: ${Math.round(progress * 100)}%
Output: exactly 3 options (ids: "A", "B", "C") — the schema rejects any other count`;
  if (step.guidance) section += `\n\nStep Guidance: ${step.guidance}`;
  const guidance = progressGuidance(progress);
  if (guidance) section += `\n${guidance}`;
  if (step.suggestsNewCharacter) {
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
  - newCharacterType: Family, Friend, Pet, Toy, or Other (schema-validated — use exactly one of these)
• The name and label must be DIFFERENT - the name is what to call them, the label describes who they are`;
  }
  return section;
}

function narrativeSection(config: StoryTypePromptConfig, prefs: string): string {
  return `=== NARRATIVE GUIDANCE ===
Style: ${config.narrativeStyle}
Pacing: ${config.pacing}
Emotional Tone: ${config.emotionalTone}

Themes:
${config.thematicElements.map((t) => `• ${t}`).join('\n')}

Child's Inspirations: ${prefs}

Instructions:
${config.storyBeatInstructions}`;
}

function newlyIntroducedSection(text: string): string {
  return `=== NEWLY INTRODUCED STORY CHARACTERS ===
The following characters were introduced BY THE CHILD during this story session. These are special characters that the child chose to add to their story, so they should continue to play an important role:

${text}

IMPORTANT: Continue to feature these newly introduced characters in the story! The child specifically chose to add them, so:
• Include them in the story continuation when narratively appropriate
• Give them actions, dialogue, or presence that advances the plot
• Consider including options that involve these characters
• Always include their id in scene.presentActors so they appear in the illustration`;
}

function worldStateSection(world: WorldState): string {
  const lines = ['=== CURRENT WORLD STATE ===', 'Continuing from the previous scene:'];
  if (world.presentCastIds.length) lines.push(`• Characters present: ${world.presentCastIds.map(castToken).join(', ')}`);
  if (world.location) lines.push(`• Location: ${world.location}`);
  lines.push('\nContinue from this state. Update location and present characters as the new beat requires.');
  return lines.join('\n');
}

const SCENE_SECTION = `=== SCENE ANNOTATION ===
scene.presentActors must include ALL characters in this scene — explicit, grammatically collapsed ("they both"), and implied ("everyone"). A missing id means a missing character in the illustration. Always include the main child's id.`;

function resolvedConfig(type: StoryTypeConfig): StoryTypePromptConfig | null {
  return type.promptConfig;
}

export function buildBeatPrompt(ctx: StoryContext, type: StoryTypeConfig, step: ArcStep, progress: number, world: WorldState | null): string {
  const config = resolvedConfig(type);
  if (!config) {
    // No StoryType prompt config: the shared storyteller message (today's legacy branch, without promptConfigs).
    return withPrefix(
      ctx,
      `${storySystemMessage(ctx, 'story_beat')}

=== CURRENT SESSION ===
Story Type: ${type.name}
Arc Step: ${step.id} (${step.label})
${step.guidance ? `Step Guidance: ${step.guidance}` : ''}
${progressGuidance(progress)}

Child's inspirations: ${ctx.preferenceSummary}`
    );
  }
  const sections = [
    `=== OBJECTIVE ===\nGenerate the next story beat for "${type.name}".\n${type.shortDescription}`,
    roleSection(config),
    contextSection(ctx),
    narrativeSection(config, ctx.preferenceSummary),
    currentBeatSection(type, step, progress),
  ];
  const introduced = formatStoryContext(ctx).newlyIntroducedContext;
  if (introduced) sections.push(newlyIntroducedSection(introduced));
  if (world && (world.presentCastIds.length || world.location)) sections.push(worldStateSection(world));
  sections.push(SCENE_SECTION);
  return withPrefix(ctx, sections.join('\n\n'));
}

export function buildEndingPrompt(ctx: StoryContext, type: StoryTypeConfig): string {
  const config = resolvedConfig(type);
  if (!config) {
    return withPrefix(
      ctx,
      `${storySystemMessage(ctx, 'ending')}

=== CURRENT SESSION ===
Story Type: ${type.name}

Child's inspirations: ${ctx.preferenceSummary}

=== YOUR TASK ===
Based on the story conversation above, generate three possible endings for the story.`
    );
  }
  const instructions =
    config.endingInstructions ||
    'Based on the story so far, generate exactly three possible endings. Each ending should: (1) resolve the story with a happy, satisfying conclusion; (2) be 1–2 paragraphs long; (3) give the main child a moment of triumph or warmth. Make the three options meaningfully different so the child has a real choice.';
  return withPrefix(
    ctx,
    [
      `=== OBJECTIVE ===\nGenerate three possible endings for "${type.name}".\n${type.shortDescription}`,
      roleSection(config),
      contextSection(ctx),
      `=== YOUR TASK ===\n${instructions}\n\nChild's Inspirations: ${ctx.preferenceSummary}`,
    ].join('\n\n')
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function arcOf(type: StoryTypeConfig): { steps: ArcStep[]; total: number } {
  return type.arcSteps.length > 0 ? { steps: type.arcSteps, total: type.arcSteps.length } : { steps: [], total: STEPLESS_BEATS };
}

function stripId(raw: string): string {
  return raw.replace(/^\$\$|\$\$$|^\[\[cast:|\]\]$/g, '').trim();
}

/** The beats so far: every prompt turn after the story-type choice is a beat's continuation. */
function beatTurns(ctx: StoryContext) {
  const beats = (ctx.modeState.beatTurnIndexes as number[] | undefined) ?? [];
  return ctx.turns.filter((t) => beats.includes(t.index));
}

export function adventureFixtureContinuation(heroCastId: string, step: number): string {
  return `${castToken(heroCastId)} took a brave step forward into part ${step + 1} of the adventure, where the trees whispered friendly secrets and the path sparkled.`;
}

export function createAdventureEngine(deps: EngineDeps & { storyTypes: AdventureCatalog }): CreationModeEngine {
  async function beat(
    ctx: StoryContext,
    type: StoryTypeConfig,
    index: number,
    childWords: string | null,
    addCast: NewCastMember[],
    /** The index the reply turn will be recorded at (after the child's input turn, if any). */
    replyIndex: number
  ): Promise<Turn> {
    const { steps, total } = arcOf(type);
    const safeIndex = Math.max(0, Math.min(index, total - 1));
    const step = steps[safeIndex] ?? DEFAULT_ARC_STEP;
    const arcProgress = total > 1 ? safeIndex / (total - 1) : 0;

    // History (today: messages subcollection, beat_options excluded): beats as the model, choices as the child.
    const history: Array<{ role: 'model' | 'user'; text: string; isBeat: boolean }> = [];
    const beatIndexes = new Set((ctx.modeState.beatTurnIndexes as number[] | undefined) ?? []);
    for (const turn of ctx.turns) {
      if (turn.kind === 'prompt' && beatIndexes.has(turn.index)) history.push({ role: 'model', text: turn.prompt ?? '', isBeat: true });
      else if (turn.kind === 'input' && history.length > 0) history.push({ role: 'user', text: turnWords(turn), isBeat: false });
    }
    if (childWords !== null && history.length > 0) history.push({ role: 'user', text: childWords, isBeat: false });
    const lengthFactor = Math.min((history.length * 1.5) / 20, 1.0);
    const progress = arcProgress * 0.7 + lengthFactor * 0.3;
    const recent = history.slice(-CONTEXT_WINDOW);
    const earlier = history.slice(0, Math.max(0, history.length - CONTEXT_WINDOW)).filter((h) => h.isBeat);

    const world = (ctx.modeState.worldState as WorldState | undefined) ?? null;
    let system = buildBeatPrompt(ctx, type, step, progress, world);
    if (earlier.length > 0) {
      system += `\n\n=== STORY SO FAR (earlier beats for continuity) ===\n${earlier.map((h) => h.text).join('\n\n')}\n\n(The most recent conversation follows in the messages below.)`;
    }
    const messages: MessageData[] = recent.map((h) => ({ role: h.role, content: [{ text: h.text }] }));
    const useMessages = messages.length > 0 && messages[messages.length - 1].role === 'user';

    const output = await generate(deps, ctx, {
      flowName: 'adventure.beat',
      ...(useMessages ? { system, messages } : { prompt: system }),
      schema: beatSchema,
      temperature: type.promptConfig?.model?.temperature ?? 0.7,
      maxOutputTokens: type.promptConfig?.model?.maxOutputTokens ?? 10000,
      fixture: () => ({
        storyContinuation: adventureFixtureContinuation(ctx.hero.castId, safeIndex),
        scene: { presentActors: [ctx.hero.castId], location: 'the whispering wood' },
        options: [
          { id: 'A', text: 'Follow the sparkly path' },
          { id: 'B', text: 'Climb the tall tree' },
          { id: 'C', text: 'Say hello to Moss', introducesCharacter: true, newCharacterName: 'Moss', newCharacterLabel: 'a shy little dragon', newCharacterType: 'Pet' as const },
        ],
      }),
    });

    const continuation = normalizeText(ctx, output.storyContinuation);
    const present = output.scene.presentActors
      .map((raw) => normalizeText(ctx, castToken(stripId(raw))))
      .flatMap((text) => extractCastIds(text));
    ctx.modeState.worldState = { presentCastIds: [...new Set([ctx.hero.castId, ...present])], location: output.scene.location ?? null } satisfies WorldState;
    ctx.modeState.lastOptions = output.options;
    ctx.modeState.arcStepIndex = safeIndex;
    ctx.modeState.phase = 'beat';
    ctx.modeState.beatTurnIndexes = [...beatIndexes, replyIndex];
    return {
      prompt: continuation,
      options: output.options.map((o) => ({ id: o.id, text: normalizeText(ctx, o.text) })),
      addCast,
      expects: 'choice',
      progress: { step: safeIndex + 1, of: total + 1 },
    };
  }

  async function endings(ctx: StoryContext, type: StoryTypeConfig, childWords: string, addCast: NewCastMember[]): Promise<Turn> {
    const messages: MessageData[] = [];
    const beatIndexes = new Set((ctx.modeState.beatTurnIndexes as number[] | undefined) ?? []);
    for (const turn of ctx.turns) {
      if (turn.kind === 'prompt' && beatIndexes.has(turn.index)) messages.push({ role: 'model', content: [{ text: turn.prompt ?? '' }] });
      else if (turn.kind === 'input' && messages.length > 0) messages.push({ role: 'user', content: [{ text: turnWords(turn) }] });
    }
    messages.push({ role: 'user', content: [{ text: childWords }] });
    const output = await generate(deps, ctx, {
      flowName: 'adventure.endings',
      system: buildEndingPrompt(ctx, type),
      messages,
      schema: endingSchema,
      temperature: type.promptConfig?.model?.temperature ?? 0.4,
      maxOutputTokens: type.promptConfig?.model?.maxOutputTokens ?? 2000,
      fixture: () => ({
        endings: [
          { id: 'A', text: `${castToken(ctx.hero.castId)} found the treasure and shared it with everyone.` },
          { id: 'B', text: `${castToken(ctx.hero.castId)} flew home on a friendly cloud.` },
          { id: 'C', text: `${castToken(ctx.hero.castId)} threw a party under the stars.` },
        ],
      }),
    });
    const list = output.endings.map((e) => ({ id: e.id, text: normalizeText(ctx, e.text) }));
    const { total } = arcOf(type);
    ctx.modeState.phase = 'ending';
    ctx.modeState.endings = list;
    return { prompt: 'How should the story end?', options: list, addCast, expects: 'choice', progress: { step: total + 1, of: total + 1 } };
  }

  async function compile(ctx: StoryContext, type: StoryTypeConfig, endingText: string): Promise<Done> {
    const draft = [...beatTurns(ctx).map((t) => t.prompt ?? ''), endingText].filter((p) => p.trim()).join('\n\n');
    const config = await deps.config.get(compilePromptConfig);
    const instructions = config.enabled && config.compilePrompt.trim() ? config.compilePrompt : DEFAULT_COMPILE_INSTRUCTIONS;
    const reference = ctx.cast.map((p) => `${castToken(p.castId)} = ${p.displayName}`).join('\n');
    const prompt = withPrefix(
      ctx,
      `${instructions}

${TOKEN_KEEP_RULE}

**Story Context:**
- **Story Type:** ${type.name} (${type.shortDescription})
- **Main Character:** ${ctx.hero.displayName} (${castToken(ctx.hero.castId)})

**CHARACTER REFERENCE (tokens and who they are):**
${reference}

**DRAFT STORY TEXT TO POLISH:**
${draft}

**OUTPUT FORMAT — STRICT:**
Your entire response must be a single raw JSON object. No markdown. No code fences. The response must begin with { and end with }.

{
  "storyText": "The polished story text, keeping every [[cast:id]] token.",
  "synopsis": "A brief 1-2 sentence summary of the story suitable for a parent to read."
}`
    );
    let text: string;
    try {
      const output = await generate(deps, ctx, {
        flowName: 'adventure.compile',
        prompt,
        schema: compileSchema,
        temperature: 0.5,
        maxOutputTokens: 8192,
        fixture: () => ({ storyText: draft, synopsis: `${displayText(ctx, castToken(ctx.hero.castId))} has an adventure.` }),
      });
      // If the model wrote names instead of tokens, put the tokens back.
      const inDraft = new Set(extractCastIds(draft));
      const people = ctx.roster.filter((p) => inDraft.has(p.castId) || ctx.cast.some((c) => c.castId === p.castId));
      text = tokenizeNames(normalizeText(ctx, output.storyText), people);
    } catch (error) {
      // As today: the draft is a story too.
      console.warn('[creation] adventure.compile fell back to the draft', (error as Error)?.message ?? error);
      text = draft;
    }
    ctx.modeState.phase = 'complete';
    return { kind: 'done', text };
  }

  async function storyTypeTurn(ctx: StoryContext): Promise<Turn> {
    const types = await deps.storyTypes.listForAge(ctx.childAge);
    if (types.length === 0) throw new ConflictError('No story styles are available right now.', { code: 'NO_STORY_TYPES' });
    ctx.modeState.phase = 'storyType';
    return {
      prompt: 'What kind of story shall we make?',
      options: types.map((t) => ({ id: t.storyTypeId, text: t.name })),
      expects: 'choice',
      progress: { step: 0 },
    };
  }

  async function requireType(ctx: StoryContext): Promise<StoryTypeConfig> {
    if (ctx.storyType) return ctx.storyType;
    const id = ctx.modeState.storyTypeId as string | undefined;
    const type = id ? await deps.storyTypes.load(id) : null;
    if (!type) throw inputNotExpected('Choose a kind of story first.');
    ctx.storyType = type;
    return type;
  }

  return {
    modeId: 'adventure',
    async start(ctx) {
      ctx.modeState.beatTurnIndexes = [];
      if (ctx.storyType) {
        ctx.modeState.storyTypeId = ctx.storyType.storyTypeId;
        return beat(ctx, ctx.storyType, 0, null, [], ctx.nextTurnIndex);
      }
      return storyTypeTurn(ctx);
    },
    async respond(ctx, input: ChildInput) {
      const phase = (ctx.modeState.phase as string | undefined) ?? 'storyType';
      const chosen = chosenOption(ctx, input);
      if (phase === 'storyType') {
        const type = await deps.storyTypes.load(chosen.id);
        if (!type || type.status !== 'live') throw inputNotExpected('That kind of story is not available.');
        ctx.storyType = type;
        ctx.modeState.storyTypeId = type.storyTypeId;
        // The story-type choice is not a story event: the first beat starts the conversation.
        return beat(ctx, type, 0, null, [], ctx.nextTurnIndex + 1);
      }
      const type = await requireType(ctx);
      if (phase === 'beat') {
        const addCast = await introduceFromOption(deps, ctx, chosen.id);
        const option = ((ctx.modeState.lastOptions as Array<z.infer<typeof beatOptionSchema>> | undefined) ?? []).find((o) => o.id === chosen.id);
        if (option?.existingCharacterId) {
          const existing = addExistingToCast(ctx, stripId(option.existingCharacterId), 'child');
          if (existing) addCast.push(existing);
        }
        const next = ((ctx.modeState.arcStepIndex as number | undefined) ?? 0) + 1;
        const { total } = arcOf(type);
        if (next > total - 1) return endings(ctx, type, chosen.text, addCast);
        return beat(ctx, type, next, chosen.text, addCast, ctx.nextTurnIndex + 1);
      }
      if (phase === 'ending') {
        const ending = ((ctx.modeState.endings as Array<{ id: string; text: string }> | undefined) ?? []).find((e) => e.id === chosen.id);
        if (!ending) throw inputNotExpected('That ending is not on offer.');
        ctx.modeState.selectedEndingId = ending.id;
        return compile(ctx, type, ending.text);
      }
      throw inputNotExpected('This story is already written.');
    },
  };
}

/** StoryType reads the adventure engine needs (bound to Firestore by the service). */
export type AdventureCatalog = {
  listForAge: (age: number | null) => Promise<StoryTypeConfig[]>;
  load: (storyTypeId: string) => Promise<StoryTypeConfig | null>;
};
