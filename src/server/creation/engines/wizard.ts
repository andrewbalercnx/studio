/**
 * `wizard` — Story Wizard (port of src/ai/flows/story-wizard-flow.ts).
 *
 * Four multiple-choice questions, then the AI writes the whole story.
 * Prompts: `storyGenerators/wizard.prompts.questionGeneration` and
 * `.storyGeneration` ({{ageDescription}}, {{context}}, the hero token).
 *
 * modeState: { answers: [{ question, answer }] } — question and answer with tokens.
 */
import { z } from 'zod';
import type { MessageData } from 'genkit';
import { ageDescription, formatStoryContext, normalizeText, type StoryContext } from '../context';
import type { ChildInput, CreationModeEngine, Done, EngineDeps, Turn } from '../engine';
import { castToken } from '../tokens';
import { chosenOption, fillTemplate, generate, modePrompt, toOptions } from './shared';

export const WIZARD_QUESTIONS = 4;

export const DEFAULT_WIZARD_QUESTION_PROMPT = `You are a friendly Story Wizard who helps a young child create a story by asking simple multiple-choice questions.

CHILD'S PROFILE:
{{ageDescription}}

CONTEXT:
{{context}}

INSTRUCTIONS:
1. Based on the conversation above (if any), devise the *next* simple, fun question to ask the child. Questions should guide the story's theme, setting, or a simple plot point.
2. Create 2 to 4 short, imaginative choices for the child to pick from.
3. Keep questions and choices very simple (a few words).
4. You MUST output a valid JSON object with the following structure, and nothing else:
   {
     "question": "The next simple question for the child",
     "choices": [
       { "text": "Choice one" },
       { "text": "Choice two" }
     ]
   }`;

export const DEFAULT_WIZARD_STORY_PROMPT = `You are a master storyteller for young children. Your task is to write a complete, short story based on a child's choices from the conversation above.

CHILD'S PROFILE:
{{ageDescription}}

CONTEXT:
{{context}}

INSTRUCTIONS:
1. Write a complete, gentle, and engaging story of about 5-7 paragraphs.
2. The story MUST use the character placeholders (e.g., $$character-id$$) instead of their names. The main character (the child) is $$CHILD_ID_PLACEHOLDER$$.
3. The story should be simple and easy for a young child to understand.
4. Conclude the story with a happy and reassuring ending.
5. You MUST output a valid JSON object with the following structure, and nothing else:
   {
     "title": "A suitable title for the story",
     "vibe": "A one-word vibe for the story (e.g., funny, magical, adventure)",
     "storyText": "The full story text, using $$document-id$$ for characters."
   }`;

const questionSchema = z.object({
  question: z.string().min(1),
  choices: z.array(z.object({ text: z.string().min(1) })).min(2).max(4),
});

const storySchema = z.object({
  title: z.string().min(1),
  vibe: z.string().default('magical'),
  storyText: z.string().min(1),
});

type Answer = { question: string; answer: string };

const LETTERS = ['A', 'B', 'C', 'D'];

function answersOf(ctx: StoryContext): Answer[] {
  const raw = ctx.modeState.answers;
  return Array.isArray(raw) ? (raw as Answer[]) : [];
}

function messagesFrom(answers: Answer[]): MessageData[] {
  return answers.flatMap((a) => [
    { role: 'model' as const, content: [{ text: a.question }] },
    { role: 'user' as const, content: [{ text: a.answer }] },
  ]);
}

function templateVars(ctx: StoryContext) {
  return { ageDescription: ageDescription(ctx.childAge), context: formatStoryContext(ctx).fullContext, childId: ctx.hero.castId };
}

/** The hero placeholder of today's prompt becomes the hero's token. */
function fill(ctx: StoryContext, template: string): string {
  return fillTemplate(template, templateVars(ctx)).split(castToken('CHILD_ID_PLACEHOLDER')).join(castToken(ctx.hero.castId));
}

const FIXTURE_QUESTIONS = ['Where should the story happen?', 'Who do you meet there?', 'What goes wrong?', 'How is it fixed?'];

export function createWizardEngine(deps: EngineDeps): CreationModeEngine {
  async function ask(ctx: StoryContext, answers: Answer[]): Promise<Turn> {
    const system = fill(ctx, modePrompt(ctx, 'questionGeneration', DEFAULT_WIZARD_QUESTION_PROMPT));
    const messages = messagesFrom(answers);
    const output = await generate(deps, ctx, {
      flowName: 'wizard.askQuestion',
      // As today: no history yet → the instructions are the prompt itself.
      ...(messages.length > 0 ? { system, messages } : { prompt: system }),
      schema: questionSchema,
      temperature: 0.8,
      fixture: () => ({
        question: FIXTURE_QUESTIONS[answers.length] ?? 'What happens next?',
        choices: [{ text: `Choice one for question ${answers.length + 1}` }, { text: `Choice two with ${castToken(ctx.hero.castId)}` }, { text: 'A surprise' }],
      }),
    });
    return {
      prompt: normalizeText(ctx, output.question),
      options: toOptions(ctx, output.choices.map((c, i) => ({ id: LETTERS[i], text: c.text }))),
      expects: 'choice',
      progress: { step: answers.length + 1, of: WIZARD_QUESTIONS },
    };
  }

  async function write(ctx: StoryContext, answers: Answer[]): Promise<Done> {
    const system = fill(ctx, modePrompt(ctx, 'storyGeneration', DEFAULT_WIZARD_STORY_PROMPT));
    const output = await generate(deps, ctx, {
      flowName: 'wizard.generateStory',
      system,
      messages: messagesFrom(answers),
      schema: storySchema,
      temperature: 0.7,
      fixture: () => ({
        title: `${ctx.hero.displayName}'s Big Day`,
        vibe: 'magical',
        storyText: wizardFixtureStory(ctx.hero.castId, answers),
      }),
    });
    ctx.modeState.vibe = output.vibe;
    return { kind: 'done', text: normalizeText(ctx, output.storyText), titleHint: output.title.trim() };
  }

  return {
    modeId: 'wizard',
    async start(ctx) {
      ctx.modeState.answers = [];
      return ask(ctx, []);
    },
    async respond(ctx, input: ChildInput) {
      const option = chosenOption(ctx, input);
      const question = [...ctx.turns].reverse().find((t) => t.kind === 'prompt')?.prompt ?? '';
      const answers = [...answersOf(ctx), { question, answer: option.text }];
      ctx.modeState.answers = answers;
      return answers.length >= WIZARD_QUESTIONS ? write(ctx, answers) : ask(ctx, answers);
    },
  };
}

/** TEST_MODE story: long enough for any picture-book length (24 pages need 24+ words). */
export function wizardFixtureStory(heroCastId: string, answers: Answer[]): string {
  const hero = castToken(heroCastId);
  const picks = answers.map((a) => a.answer).join(', ') || 'a sunny day';
  return [
    `Once upon a time, ${hero} woke up early and decided that today would be an adventure. The sun was shining and the birds were singing.`,
    `${hero} remembered the choices of the day: ${picks}. Each one made the adventure sparkle a little more.`,
    `Along the way ${hero} met friendly creatures, crossed a wobbly bridge, and found a hidden garden full of glowing flowers.`,
    `When a small problem appeared, ${hero} was brave and kind, and soon everything was fixed with a smile.`,
    `At the end of the day ${hero} went home, happy and sleepy, already dreaming of the next adventure. The end.`,
  ].join('\n\n');
}
