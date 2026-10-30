/**
 * `friends` — Fun with my friends (port of src/ai/flows/friends-flow.ts).
 *
 *   start            the AI proposes 2–5 companions from the family   → castPick
 *   castPick         the child confirms or changes them (hero always) → scenarios (A–D)
 *   choice           a scenario                                        → synopses (A–C, "more")
 *   choice "more"    new synopses                                      → synopses
 *   choice           a synopsis                                        → done (story + title hint)
 *
 * The chosen companions join the cast (`addedBy: 'child'`) with the castPick
 * turn; the story may use no one else (as today). Prompts:
 * `storyGenerators/friends.prompts.{characterProposal, scenarioGeneration,
 * synopsisGeneration, storyGeneration}`, temperatures per prompt from
 * `promptConfig` (per-prompt models are not honoured, ADR-0008).
 *
 * modeState: { phase, proposedIds, rationale, selectedIds, scenarios, selectedScenarioId, synopses }.
 */
import { z } from 'zod';
import { ageDescription, describePerson, normalizeText, type CastPerson, type StoryContext } from '../context';
import { temperatureFor } from '../modes';
import type { ChildInput, CreationModeEngine, Done, EngineDeps, NewCastMember, Turn } from '../engine';
import { castToken } from '../tokens';
import { addExistingToCast, chosenOption, fillTemplate, generate, inputNotExpected, modePrompt } from './shared';

const ENTITY_ID_RULE = `CRITICAL: Use $$id$$ placeholders for ALL character references. Never use display names directly.
   - Correct: "$$abc123$$ discovers a magical garden"
   - Wrong: "Emma discovers a magical garden"`;

export const DEFAULT_FRIENDS_PROMPTS: Record<string, string> = {
  characterProposal: `You are a friendly story helper for children.

CHILD'S PROFILE:
{{ageDescription}}

AVAILABLE CHARACTERS FOR THE ADVENTURE:
{{availableCharacters}}

INSTRUCTIONS:
1. Select 2-5 characters from the available list who would make for an exciting adventure together.
2. Always include the main child as a character.
3. Choose a diverse mix (e.g., include a pet or toy if available, mix family and friends).
4. Consider what combinations would create interesting story dynamics.
5. Return your selection as a JSON object.

OUTPUT FORMAT:
{
  "proposedCharacterIds": ["id1", "id2", "id3"],
  "rationale": "A brief explanation of why these characters would have fun together"
}`,
  scenarioGeneration: `You are creating imaginative adventure scenarios for a children's story!

CHILD'S PROFILE:
{{ageDescription}}

SELECTED CHARACTERS (use $$id$$ placeholders when referencing them):
{{selectedCharacters}}

WHY THESE CHARACTERS WERE CHOSEN:
{{characterRationale}}

YOUR MISSION:
Create 3-4 delightful, inventive adventure scenarios — magical and surprising, but ALWAYS warm, cheerful, and age-appropriate. Aim for wonder, not darkness.

INSPIRATION (mix and match, or invent something entirely new!):
- Shrink down to ant-size and explore the garden as a jungle
- Discover the toys come alive at night and need help with a problem
- Find a rainbow bridge to a land made entirely of desserts
- A friendly dragon asks for help finding its lost treasure
- Get swept into a painting and explore the world inside
- Discover the pets can talk and have a secret mission
- Find a magic door in an unexpected place (closet, tree, puddle)
- Help the moon gather lost stars that fell to Earth
- Become superheroes for a day with silly but useful powers
- Explore an upside-down world where everything is backwards

GUIDELINES:
1. Be INVENTIVE - surprise and delight! Avoid generic "go to the park" scenarios.
2. Include a sense of wonder, magic, or whimsy in each option.
3. Make scenarios age-appropriate: cheerful, safe, and never scary or sad.
4. Each scenario should feel like the start of an amazing adventure!
5. Every selected character must have a meaningful role in EACH scenario — do not leave anyone out.
6. Use each character's unique traits creatively - consider their likes, personality, and type when assigning roles.
7. ${ENTITY_ID_RULE}

OUTPUT FORMAT:
{
  "scenarios": [
    { "id": "A", "title": "Catchy, exciting title!", "description": "1-2 sentences capturing the magical premise and what makes it exciting" },
    { "id": "B", "title": "...", "description": "..." }
  ]
}`,
  synopsisGeneration: `You are a children's story writer drafting story ideas.

CHILD'S PROFILE:
{{ageDescription}}

SELECTED CHARACTERS (use $$id$$ placeholders when referencing them):
{{selectedCharacters}}

WHY THESE CHARACTERS WERE CHOSEN:
{{characterRationale}}

CHOSEN SCENARIO:
{{selectedScenario}}

INSTRUCTIONS:
1. Write 3 brief story synopses based on the chosen scenario.
2. Each synopsis should be 2-3 sentences that capture the story arc.
3. Include a beginning, middle (with a small challenge), and happy ending.
4. Make each synopsis distinctly different while fitting the scenario.
5. Every selected character must appear in each synopsis.
6. Use each character's unique traits - consider their personality, likes, and type.
7. ${ENTITY_ID_RULE}

OUTPUT FORMAT:
{
  "synopses": [
    { "id": "A", "title": "Story Title", "summary": "2-3 sentence synopsis..." },
    { "id": "B", "title": "...", "summary": "..." }
  ]
}`,
  storyGeneration: `You are a master storyteller for young children.

CHILD'S PROFILE:
{{ageDescription}}

CHARACTERS (use $$id$$ placeholders in your story):
{{selectedCharacters}}

WHY THESE CHARACTERS WERE CHOSEN:
{{characterRationale}}

STORY SYNOPSIS:
{{selectedSynopsis}}

INSTRUCTIONS:
1. Write a complete, engaging story of 5-7 paragraphs based on the synopsis.
2. The story should be simple and age-appropriate.
3. Include dialogue and action to make it engaging.
4. End with a happy, satisfying conclusion.
5. Keep paragraphs short for young readers.
6. Use each character's unique traits - consider their personality, likes, and pronouns.
7. ${ENTITY_ID_RULE}
8. Do NOT introduce any new characters. Only use the characters listed above.

OUTPUT FORMAT:
{
  "title": "The Story Title",
  "vibe": "One-word mood (e.g., magical, funny, adventurous)",
  "storyText": "The complete story text with $$id$$ placeholders..."
}`,
};

const DEFAULT_TEMPERATURES: Record<string, number> = {
  characterProposal: 0.8,
  scenarioGeneration: 1.2,
  synopsisGeneration: 0.9,
  storyGeneration: 0.7,
};

const proposalSchema = z.object({ proposedCharacterIds: z.array(z.string()), rationale: z.string() });
const scenariosSchema = z.object({ scenarios: z.array(z.object({ id: z.string(), title: z.string(), description: z.string() })).min(2).max(5) });
const synopsesSchema = z.object({ synopses: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string() })).min(2).max(4) });
const storySchema = z.object({ title: z.string().min(1), vibe: z.string().default('adventurous'), storyText: z.string().min(1) });

type Scenario = z.infer<typeof scenariosSchema>['scenarios'][number];
type Synopsis = z.infer<typeof synopsesSchema>['synopses'][number];

export const MORE_SYNOPSES_ID = 'more';
const DEFAULT_RATIONALE = 'These characters were selected for an exciting adventure together.';

function stripToken(raw: string): string {
  return raw.replace(/^\$\$|\$\$$|^\[\[cast:|\]\]$/g, '').trim();
}

function prompt(ctx: StoryContext, key: string): string {
  return modePrompt(ctx, key, DEFAULT_FRIENDS_PROMPTS[key]);
}

function selectedPeople(ctx: StoryContext): CastPerson[] {
  const ids = (ctx.modeState.selectedIds as string[] | undefined) ?? [ctx.hero.castId];
  return ids.map((id) => ctx.roster.find((p) => p.castId === id)).filter((p): p is CastPerson => !!p);
}

function selectedText(ctx: StoryContext): string {
  return selectedPeople(ctx)
    .map((p, i) => `${i + 1}. ${describePerson(p)}`)
    .join('\n\n');
}

export function friendsFixtureStory(ctx: StoryContext): string {
  const names = selectedPeople(ctx).map((p) => castToken(p.castId));
  const together = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return [
    `One bright morning ${together} found a rainbow bridge at the bottom of the garden.`,
    `They crossed it together and discovered a land where the clouds were made of candyfloss.`,
    `After a day of games and giggles, ${together} came home tired and happy. The end.`,
  ].join('\n\n');
}

export function createFriendsEngine(deps: EngineDeps): CreationModeEngine {
  async function proposeCast(ctx: StoryContext): Promise<Turn> {
    const available = ctx.roster.map((p, i) => `${i + 1}. ${describePerson(p)}`).join('\n\n');
    const output = await generate(deps, ctx, {
      flowName: 'friends.characterProposal',
      prompt: fillTemplate(prompt(ctx, 'characterProposal'), { ageDescription: ageDescription(ctx.childAge), availableCharacters: available }),
      schema: proposalSchema,
      temperature: temperatureFor(ctx.mode, 'characterProposal', DEFAULT_TEMPERATURES.characterProposal),
      fixture: () => ({ proposedCharacterIds: ctx.roster.slice(0, 3).map((p) => p.castId), rationale: 'They love adventures together.' }),
    });
    const known = new Set(ctx.roster.map((p) => p.castId));
    const proposed = new Set(output.proposedCharacterIds.map(stripToken).filter((id) => known.has(id)));
    proposed.add(ctx.hero.castId);
    for (const member of ctx.castMembers) proposed.add(member.castId); // chosen at setup
    ctx.modeState.phase = 'cast';
    ctx.modeState.proposedIds = [...proposed];
    ctx.modeState.rationale = output.rationale;
    return {
      prompt: "Here are some friends who'd love to go on an adventure with you!",
      options: ctx.roster.map((p) => ({ id: p.castId, text: castToken(p.castId), preselected: proposed.has(p.castId) })),
      expects: 'castPick',
      progress: { step: 1, of: 4 },
    };
  }

  async function scenarios(ctx: StoryContext, addCast: NewCastMember[]): Promise<Turn> {
    const output = await generate(deps, ctx, {
      flowName: 'friends.scenarioGeneration',
      prompt: fillTemplate(prompt(ctx, 'scenarioGeneration'), {
        ageDescription: ageDescription(ctx.childAge),
        selectedCharacters: selectedText(ctx),
        characterRationale: (ctx.modeState.rationale as string) || DEFAULT_RATIONALE,
      }),
      schema: scenariosSchema,
      temperature: temperatureFor(ctx.mode, 'scenarioGeneration', DEFAULT_TEMPERATURES.scenarioGeneration),
      fixture: () => ({
        scenarios: [
          { id: 'A', title: 'The Rainbow Bridge', description: `${castToken(ctx.hero.castId)} finds a bridge to a land of desserts.` },
          { id: 'B', title: 'Tiny Explorers', description: 'Everyone shrinks to the size of an ant.' },
          { id: 'C', title: 'Moon Helpers', description: 'The moon needs help gathering lost stars.' },
        ],
      }),
    });
    const list: Scenario[] = output.scenarios.map((s) => ({ id: s.id, title: normalizeText(ctx, s.title), description: normalizeText(ctx, s.description) }));
    ctx.modeState.phase = 'scenario';
    ctx.modeState.scenarios = list;
    return {
      prompt: 'What kind of adventure should we have?',
      options: list.map((s) => ({ id: s.id, text: `${s.title}: ${s.description}` })),
      addCast,
      expects: 'choice',
      progress: { step: 2, of: 4 },
    };
  }

  async function synopses(ctx: StoryContext, more: boolean): Promise<Turn> {
    const scenario = ((ctx.modeState.scenarios as Scenario[] | undefined) ?? []).find((s) => s.id === ctx.modeState.selectedScenarioId);
    if (!scenario) throw inputNotExpected('Pick an adventure first.');
    let template = prompt(ctx, 'synopsisGeneration');
    if (more) template += '\n\nIMPORTANT: Generate completely NEW and DIFFERENT synopses from any previous ones.';
    const base = temperatureFor(ctx.mode, 'synopsisGeneration', DEFAULT_TEMPERATURES.synopsisGeneration);
    const round = ((ctx.modeState.synopsisRound as number | undefined) ?? 0) + 1;
    const output = await generate(deps, ctx, {
      flowName: 'friends.synopsisGeneration',
      prompt: fillTemplate(template, {
        ageDescription: ageDescription(ctx.childAge),
        selectedCharacters: selectedText(ctx),
        selectedScenario: `${scenario.title}: ${scenario.description}`,
        characterRationale: (ctx.modeState.rationale as string) || DEFAULT_RATIONALE,
      }),
      schema: synopsesSchema,
      temperature: more ? Math.min(base + 0.2, 2.0) : base,
      fixture: () => ({
        synopses: [
          { id: 'A', title: `Story idea ${round}A`, summary: `${castToken(ctx.hero.castId)} and friends share a day of wonder.` },
          { id: 'B', title: `Story idea ${round}B`, summary: 'A small problem is solved with kindness.' },
          { id: 'C', title: `Story idea ${round}C`, summary: 'A surprise party under the stars.' },
        ],
      }),
    });
    const list: Synopsis[] = output.synopses.map((s) => ({ id: s.id, title: normalizeText(ctx, s.title), summary: normalizeText(ctx, s.summary) }));
    ctx.modeState.phase = 'synopsis';
    ctx.modeState.synopses = list;
    ctx.modeState.synopsisRound = round;
    return {
      prompt: 'Which story sounds the most fun?',
      options: [...list.map((s) => ({ id: s.id, text: `${s.title}: ${s.summary}` })), { id: MORE_SYNOPSES_ID, text: 'Show me different stories' }],
      expects: 'choice',
      progress: { step: 3, of: 4 },
    };
  }

  async function story(ctx: StoryContext, synopsis: Synopsis): Promise<Done> {
    const output = await generate(deps, ctx, {
      flowName: 'friends.storyGeneration',
      prompt: fillTemplate(prompt(ctx, 'storyGeneration'), {
        ageDescription: ageDescription(ctx.childAge),
        selectedCharacters: selectedText(ctx),
        selectedSynopsis: `${synopsis.title}: ${synopsis.summary}`,
        characterRationale: (ctx.modeState.rationale as string) || DEFAULT_RATIONALE,
      }),
      schema: storySchema,
      temperature: temperatureFor(ctx.mode, 'storyGeneration', DEFAULT_TEMPERATURES.storyGeneration),
      fixture: () => ({ title: synopsis.title, vibe: 'magical', storyText: friendsFixtureStory(ctx) }),
    });
    ctx.modeState.phase = 'complete';
    ctx.modeState.vibe = output.vibe;
    return { kind: 'done', text: normalizeText(ctx, output.storyText), titleHint: output.title.trim() };
  }

  return {
    modeId: 'friends',
    start: proposeCast,
    async respond(ctx, input: ChildInput) {
      const phase = (ctx.modeState.phase as string | undefined) ?? 'cast';
      if (phase === 'cast') {
        if (input.kind !== 'castPick') throw inputNotExpected('Choose who comes on the adventure.');
        const known = new Set(ctx.roster.map((p) => p.castId));
        const unknown = input.castIds.filter((id) => !known.has(id));
        if (unknown.length > 0) throw inputNotExpected('Some of those friends are not in your family.');
        const selected = [ctx.hero.castId, ...input.castIds.filter((id) => id !== ctx.hero.castId)];
        const unique = [...new Set(selected)];
        ctx.modeState.selectedIds = unique;
        const addCast = unique.map((id) => addExistingToCast(ctx, id, 'child')).filter((m): m is NewCastMember => !!m);
        return scenarios(ctx, addCast);
      }
      if (phase === 'scenario') {
        ctx.modeState.selectedScenarioId = chosenOption(ctx, input).id;
        return synopses(ctx, false);
      }
      if (phase === 'synopsis') {
        const chosen = chosenOption(ctx, input);
        if (chosen.id === MORE_SYNOPSES_ID) return synopses(ctx, true);
        const synopsis = ((ctx.modeState.synopses as Synopsis[] | undefined) ?? []).find((s) => s.id === chosen.id);
        if (!synopsis) throw inputNotExpected('That story is not on offer.');
        ctx.modeState.selectedSynopsisId = synopsis.id;
        return story(ctx, synopsis);
      }
      throw inputNotExpected('This story is already written.');
    },
  };
}
