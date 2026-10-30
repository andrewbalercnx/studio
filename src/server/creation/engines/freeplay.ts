/**
 * `freeplay` — Free Play (port of src/ai/flows/gemini3-flow.ts, today's
 * `gemini3`).
 *
 * Open conversation: the model asks, the child picks an option or types, and
 * the model decides when the story is complete. Pacing comes from the number
 * of turns (the "story temperature" over ~15 exchanges). Options may introduce
 * a new character; when the child picks one, the character is created and
 * joins the cast with that turn (today the browser did this through
 * /api/characters/create).
 *
 * Prompt: `storyGenerators/gemini3.prompts.systemPrompt` ({{systemMessage}},
 * {{temperatureGuidance}}, {{childPreferenceSummary}}, {{sessionContext}}).
 * modeState: { lastOptions: model options with their character metadata }.
 */
import { z } from 'zod';
import { ServiceUnavailableError } from '../../errors';
import { normalizeText, type StoryContext } from '../context';
import type { ChildInput, CreationModeEngine, EngineDeps, NewCastMember, Turn, Done } from '../engine';
import { castToken } from '../tokens';
import {
  chosenOption,
  fillTemplate,
  generate,
  inputNotExpected,
  inputWords,
  introduceCharacter,
  modePrompt,
  recentStory,
  storySystemMessage,
  toOptions,
  turnWords,
} from './shared';

export const DEFAULT_FREEPLAY_PROMPT = `{{systemMessage}}

=== GEMINI 3 MODE ===
You have complete creative freedom to craft an amazing story through conversation.
Ask creative questions, build the story based on answers, and guide toward a satisfying conclusion.
{{temperatureGuidance}}

=== CURRENT SESSION ===
Child's inspirations: {{childPreferenceSummary}}

{{sessionContext}}

=== OUTPUT FORMAT ===
When CONTINUING: { "question": "...", "options": [...], "isStoryComplete": false, "finalStory": null }
When ENDING: { "question": "", "options": [], "isStoryComplete": true, "finalStory": "complete story (5-7 paragraphs)" }`;

const optionSchema = z.object({
  id: z.string().describe("A single uppercase letter, e.g., 'A', 'B', 'C', 'D'."),
  text: z.string().describe('A short, child-friendly choice.'),
  introducesCharacter: z.boolean().optional().describe('Set to true if this option introduces a new character.'),
  newCharacterName: z.string().optional().describe("If introducesCharacter is true, the character's proper name."),
  newCharacterLabel: z.string().optional().describe('If introducesCharacter is true, a descriptive phrase.'),
  newCharacterType: z.string().optional().describe('If introducesCharacter is true, one of: Family, Friend, Pet, Toy, Other.'),
});

const outputSchema = z.object({
  question: z.string().describe('The next question or story continuation. Empty string when story is complete.'),
  options: z.array(optionSchema).describe('2-4 choices during story development. Empty array when story is complete.'),
  isStoryComplete: z.boolean().optional().describe('Set to true if the story has reached a natural conclusion.'),
  finalStory: z.string().nullable().optional().describe('If isStoryComplete is true, the complete story text with [[cast:id]] tokens.'),
});

export type ModelOption = z.infer<typeof optionSchema>;

/** Exchanges after which the story must wrap up (today: temperature > 0.8 of 15). */
export const FREEPLAY_EXCHANGES = 15;

export function freeplayFixtureStory(heroCastId: string): string {
  const hero = castToken(heroCastId);
  return [
    `${hero} set off on a free and wonderful adventure, choosing every step of the way.`,
    `There were giggles, surprises and a very friendly cloud that liked to sing.`,
    `When the sun went down, ${hero} went home happy, with a heart full of stories to tell. The end.`,
  ].join('\n\n');
}

/** Character introduction attached to a chosen option (freeplay and guided). */
export async function introduceFromOption(
  deps: EngineDeps,
  ctx: StoryContext,
  optionId: string
): Promise<NewCastMember[]> {
  const options = (ctx.modeState.lastOptions as ModelOption[] | undefined) ?? [];
  const option = options.find((o) => o.id === optionId);
  if (!option?.introducesCharacter) return [];
  const member = await introduceCharacter(deps, ctx, {
    name: option.newCharacterName,
    label: option.newCharacterLabel,
    type: option.newCharacterType,
    storyContext: recentStory(ctx),
  });
  return [member];
}

export function createFreeplayEngine(deps: EngineDeps): CreationModeEngine {
  async function next(ctx: StoryContext, childWords: string | null, addCast: NewCastMember[]): Promise<Turn | Done> {
    // Every recorded turn plus the child's new input (today: the messages subcollection).
    const lines = ctx.turns
      .map((t) => (t.kind === 'prompt' ? `Gemini: ${t.prompt ?? ''}` : t.kind === 'input' ? `Child: ${turnWords(t)}` : ''))
      .filter(Boolean);
    if (childWords !== null) lines.push(`Child: ${childWords}`);
    const messageCount = lines.length;
    const temperature = Math.min(messageCount / FREEPLAY_EXCHANGES, 1.0);
    const pct = Math.round(temperature * 100);
    const temperatureGuidance =
      temperature > 0.8
        ? `\n\n**CRITICAL: STORY CONCLUSION NEEDED**\nThe story is ${pct}% complete (${messageCount} exchanges). You MUST wrap up the story now. Set isStoryComplete to true and provide the finalStory with a satisfying ending. The child has had a wonderful journey - bring it to a close!`
        : temperature > 0.6
          ? `\n\n**STORY PROGRESSION: APPROACHING END**\nThe story is ${pct}% complete (${messageCount} exchanges). Begin guiding toward the climax and conclusion. Your next 2-3 questions should build toward a satisfying ending.`
          : temperature > 0.4
            ? `\n\n**STORY PROGRESSION: DEVELOPING**\nThe story is ${pct}% complete (${messageCount} exchanges). Continue developing the adventure while keeping the eventual conclusion in mind. Don't introduce major new plot threads.`
            : '';
    const history = lines.join('\n');
    const instruction =
      temperature > 0.8
        ? `\n\n**YOU MUST END THE STORY NOW.**\nDo NOT ask another question. Do NOT provide options.\nInstead:\n1. Set "isStoryComplete": true\n2. Set "question": "" (empty string)\n3. Set "options": [] (empty array)\n4. Provide "finalStory": A complete, satisfying story (5-7 paragraphs) that wraps up all the adventures ${history ? 'based on all the choices the child made' : ''}.`
        : `\nContinue the story based on what the child has told you. Ask the next creative question or advance the plot!`;
    const sessionContext =
      messageCount === 0
        ? `=== STARTING THE STORY ===\nWelcome the child warmly and ask an exciting opening question!`
        : `=== CONVERSATION SO FAR ===\n${history}${instruction}`;
    const prompt = fillTemplate(modePrompt(ctx, 'systemPrompt', DEFAULT_FREEPLAY_PROMPT), {
      systemMessage: storySystemMessage(ctx, 'story_beat'),
      temperatureGuidance,
      childPreferenceSummary: ctx.preferenceSummary,
      sessionContext,
    });

    const askedSoFar = ctx.turns.filter((t) => t.kind === 'prompt').length;
    const output = await generate(deps, ctx, {
      flowName: 'freeplay.respond',
      prompt,
      schema: outputSchema,
      temperature: ctx.mode.temperature ?? 0.9,
      maxOutputTokens: 8000,
      fixture: () =>
        askedSoFar >= 2
          ? { question: '', options: [], isStoryComplete: true, finalStory: freeplayFixtureStory(ctx.hero.castId) }
          : {
              question: askedSoFar === 0 ? `Hello ${castToken(ctx.hero.castId)}! Where shall we go today?` : 'What happens next?',
              options: [
                { id: 'A', text: 'Into the magic forest' },
                { id: 'B', text: 'Up to the clouds' },
                { id: 'C', text: 'Meet a new friend', introducesCharacter: true, newCharacterName: 'Bramble', newCharacterLabel: 'a friendly hedgehog', newCharacterType: 'Pet' },
              ],
              isStoryComplete: false,
              finalStory: null,
            },
    });

    if (output.isStoryComplete && output.finalStory?.trim()) {
      return { kind: 'done', text: normalizeText(ctx, output.finalStory), addCast };
    }
    const options = output.options ?? [];
    ctx.modeState.lastOptions = options;
    return {
      prompt: normalizeText(ctx, output.question),
      options: toOptions(ctx, options),
      addCast,
      expects: options.length > 0 ? 'choice' : 'text',
      progress: { step: askedSoFar + 1 },
    };
  }

  return {
    modeId: 'freeplay',
    async start(ctx) {
      const result = await next(ctx, null, []);
      if (result.kind === 'done') throw new ServiceUnavailableError('The story helper got muddled. Please try again.', { code: 'AI_BAD_OUTPUT' });
      return result;
    },
    async respond(ctx, input: ChildInput) {
      if (input.kind === 'castPick') throw inputNotExpected('Pick a choice or type an answer.');
      const words = inputWords(ctx, input);
      const addCast = input.kind === 'choice' ? await introduceFromOption(deps, ctx, chosenOption(ctx, input).id) : [];
      return next(ctx, words, addCast);
    },
  };
}
