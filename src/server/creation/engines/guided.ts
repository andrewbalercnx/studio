/**
 * `guided` — Guided Story (port of src/ai/flows/gemini4-flow.ts, today's
 * `gemini4`).
 *
 * A structured conversation: opening → setting → characters → conflict →
 * action → development → resolution (6 questions for children up to 5, else
 * 8). Options A–C plus M ("Tell me more"); an option may introduce a new
 * character (created and added to the cast with the turn) or point at an
 * existing one (added to the cast when chosen).
 *
 * Prompts: `storyGenerators/gemini4.prompts.systemPrompt` ({{systemMessage}},
 * {{phaseGuidance}}, {{childPreferenceSummary}}) and `phase_<name>`
 * ({{maxQuestions}}, {{phase}}).
 * modeState: { lastOptions }.
 */
import { z } from 'zod';
import type { MessageData } from 'genkit';
import { ServiceUnavailableError } from '../../errors';
import { normalizeText, type StoryContext } from '../context';
import type { ChildInput, CreationModeEngine, Done, EngineDeps, NewCastMember, Turn } from '../engine';
import { castToken } from '../tokens';
import { introduceFromOption } from './freeplay';
import { addExistingToCast, chosenOption, fillTemplate, generate, inputNotExpected, inputWords, modePrompt, storySystemMessage, toOptions, turnsAsMessages } from './shared';

export const DEFAULT_GUIDED_PROMPT = `{{systemMessage}}

=== GEMINI 4 MODE ===
Guide the child through a structured story creation with focused questions.
Provide 4 options: A, B, C (story choices) and M ("Tell me more").
{{phaseGuidance}}

=== CURRENT SESSION ===
Child's inspirations: {{childPreferenceSummary}}

=== OUTPUT FORMAT ===
{
  "question": "...",
  "options": [{ "id": "A", "text": "...", "isMoreOption": false, "introducesCharacter": false, "newCharacterName": "", "newCharacterLabel": "", "newCharacterType": "", "existingCharacterId": "" }],
  "isStoryComplete": false,
  "finalStory": "",
  "questionPhase": "opening|setting|characters|conflict|resolution|complete"
}

When story complete: question="", options=[], isStoryComplete=true, finalStory="full story with $$id$$ placeholders"`;

export const DEFAULT_GUIDED_PHASES: Record<string, string> = {
  opening: `**OPENING QUESTION (Phase 1/{{maxQuestions}})**
Ask an exciting opening question to understand what kind of adventure the child wants.
Focus on: What does $$childId$$ want to do today? Where do they want to go?
Include options that reference existing characters if available.`,
  setting: `**SETTING QUESTION (Phase 2/{{maxQuestions}})**
Build on their first choice. Establish where the story takes place.
Focus on: Describe the setting with sensory details. What does $$childId$$ see, hear, smell?`,
  characters: `**CHARACTER QUESTION (Phase 3/{{maxQuestions}})**
Introduce or involve characters in the story.
Focus on: Who does $$childId$$ meet? Consider siblings and existing characters.
Options should involve known characters or introduce new ones.`,
  conflict: `**PROBLEM/CONFLICT QUESTION (Phase 4/{{maxQuestions}})**
Introduce a challenge or exciting situation.
Focus on: What problem arises? What needs to be solved or discovered?`,
  action: `**ACTION QUESTION (Phase 5/{{maxQuestions}})**
The child takes action to address the challenge.
Focus on: How does $$childId$$ respond? What do they decide to do?`,
  resolution: `**RESOLUTION QUESTION (Final Phase)**
Time to wrap up the story with a satisfying conclusion.
Focus on: How does the adventure end? What did $$childId$$ learn or accomplish?
After this response, you should complete the story.`,
  development: `**DEVELOPMENT QUESTION (Phase {{phase}}/{{maxQuestions}})**
Continue developing the story based on their choices.
Build tension or add interesting developments.`,
};

const optionSchema = z.object({
  id: z.string().describe("A single uppercase letter: 'A', 'B', 'C', or 'M' for 'Tell me more'."),
  text: z.string().describe('A short, child-friendly choice.'),
  isMoreOption: z.boolean().describe("True only for the 'Tell me more' option."),
  introducesCharacter: z.boolean().describe('True if this option introduces a new character.'),
  newCharacterName: z.string().describe("If introducesCharacter, a proper name like 'Nutsy'. Otherwise empty string."),
  newCharacterLabel: z.string().describe('If introducesCharacter, a descriptive phrase. Otherwise empty string. Must be DIFFERENT from newCharacterName.'),
  newCharacterType: z.string().describe('If introducesCharacter: Family, Friend, Pet, Toy, or Other. Otherwise empty string.'),
  existingCharacterId: z.string().describe('If referencing an existing character, their id. Otherwise empty string.'),
});

const outputSchema = z.object({
  question: z.string(),
  options: z.array(optionSchema),
  isStoryComplete: z.boolean(),
  finalStory: z.string(),
  questionPhase: z.string(),
});

type GuidedOption = z.infer<typeof optionSchema>;

export const START_MESSAGE = 'Please start the story by asking me an exciting opening question!';
export const MORE_MESSAGE = 'Tell me more about this. Can you explain it differently or give me more options?';

export function maxGuidedQuestions(age: number | null): number {
  return age !== null && age <= 5 ? 6 : 8;
}

function phaseGuidance(ctx: StoryContext, questionCount: number): string {
  const maxQuestions = maxGuidedQuestions(ctx.childAge);
  const vars = { maxQuestions, phase: questionCount + 1 };
  const phase = (name: string) => fillTemplate(modePrompt(ctx, `phase_${name}`, DEFAULT_GUIDED_PHASES[name]), vars);
  if (questionCount === 0) return phase('opening');
  if (questionCount === 1) return phase('setting');
  if (questionCount === 2) return phase('characters');
  if (questionCount === 3) return phase('conflict');
  if (questionCount === 4) return phase('action');
  if (questionCount >= maxQuestions - 1) return phase('resolution');
  return phase('development');
}

export function guidedFixtureStory(heroCastId: string): string {
  const hero = castToken(heroCastId);
  return [
    `${hero} stepped through the garden gate into a place full of humming flowers.`,
    `A gentle problem appeared, and ${hero} solved it with courage and a big smile.`,
    `Everyone cheered, and ${hero} walked home proud and happy. The end.`,
  ].join('\n\n');
}

export function createGuidedEngine(deps: EngineDeps): CreationModeEngine {
  async function next(ctx: StoryContext, message: string, addCast: NewCastMember[]): Promise<Turn | Done> {
    const questionCount = ctx.turns.filter((t) => t.kind === 'prompt').length;
    const system = fillTemplate(modePrompt(ctx, 'systemPrompt', DEFAULT_GUIDED_PROMPT), {
      systemMessage: storySystemMessage(ctx, 'story_beat'),
      phaseGuidance: phaseGuidance(ctx, questionCount),
      childPreferenceSummary: ctx.preferenceSummary,
    });
    // Chat history: the opening request, then the recorded turns, then the child's new message.
    const messages: MessageData[] = [
      { role: 'user', content: [{ text: START_MESSAGE }] },
      ...turnsAsMessages(ctx),
    ];
    if (ctx.turns.length > 0) messages.push({ role: 'user', content: [{ text: message }] });

    const maxQuestions = maxGuidedQuestions(ctx.childAge);
    const output = await generate(deps, ctx, {
      flowName: 'guided.respond',
      system,
      messages,
      schema: outputSchema,
      temperature: ctx.mode.temperature ?? 0.85,
      maxOutputTokens: 4000,
      fixture: () =>
        questionCount >= 2
          ? { question: '', options: [], isStoryComplete: true, finalStory: guidedFixtureStory(ctx.hero.castId), questionPhase: 'complete' }
          : {
              question: questionCount === 0 ? `What does ${castToken(ctx.hero.castId)} want to do today?` : 'Where does the story happen?',
              options: [
                { id: 'A', text: 'Explore a castle', isMoreOption: false, introducesCharacter: false, newCharacterName: '', newCharacterLabel: '', newCharacterType: '', existingCharacterId: '' },
                { id: 'B', text: 'Sail a boat', isMoreOption: false, introducesCharacter: false, newCharacterName: '', newCharacterLabel: '', newCharacterType: '', existingCharacterId: '' },
                { id: 'C', text: 'Meet Pip the owl', isMoreOption: false, introducesCharacter: true, newCharacterName: 'Pip', newCharacterLabel: 'a wise little owl', newCharacterType: 'Pet', existingCharacterId: '' },
                { id: 'M', text: 'Tell me more', isMoreOption: true, introducesCharacter: false, newCharacterName: '', newCharacterLabel: '', newCharacterType: '', existingCharacterId: '' },
              ],
              isStoryComplete: false,
              finalStory: '',
              questionPhase: questionCount === 0 ? 'opening' : 'setting',
            },
    });

    if (output.isStoryComplete && output.finalStory.trim()) {
      return { kind: 'done', text: normalizeText(ctx, output.finalStory), addCast };
    }
    ctx.modeState.lastOptions = output.options;
    ctx.modeState.questionPhase = output.questionPhase || 'opening';
    return {
      prompt: normalizeText(ctx, output.question),
      options: toOptions(ctx, output.options),
      addCast,
      expects: output.options.length > 0 ? 'choice' : 'text',
      progress: { step: questionCount + 1, of: maxQuestions },
    };
  }

  return {
    modeId: 'guided',
    async start(ctx) {
      const result = await next(ctx, START_MESSAGE, []);
      if (result.kind === 'done') throw new ServiceUnavailableError('The story helper got muddled. Please try again.', { code: 'AI_BAD_OUTPUT' });
      return result;
    },
    async respond(ctx, input: ChildInput) {
      if (input.kind === 'castPick') throw inputNotExpected('Pick a choice or type an answer.');
      if (input.kind === 'text') return next(ctx, inputWords(ctx, input), []);
      const chosen = chosenOption(ctx, input);
      const option = ((ctx.modeState.lastOptions as GuidedOption[] | undefined) ?? []).find((o) => o.id === chosen.id);
      if (option?.isMoreOption) return next(ctx, MORE_MESSAGE, []);
      const addCast = await introduceFromOption(deps, ctx, chosen.id);
      if (option?.existingCharacterId) {
        const existing = addExistingToCast(ctx, option.existingCharacterId.replace(/^\$\$|\$\$$|^\[\[cast:|\]\]$/g, '').trim(), 'child');
        if (existing) addCast.push(existing);
      }
      return next(ctx, chosen.text, addCast);
    },
  };
}
