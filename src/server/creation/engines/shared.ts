/**
 * Helpers every engine uses: the model call (with its TEST_MODE fixture),
 * prompt templates, the shared storyteller system message, conversation
 * history from turns, and adding people to the cast (existing family members
 * or AI-introduced characters).
 */
import { createHash } from 'node:crypto';
import type { MessageData } from 'genkit';
import { z } from 'zod';
import type { ChildInput, StoryTurn } from '../../data/schemas/story';
import type { WithId } from '../../data/repository';
import { BadRequestError, ServiceUnavailableError } from '../../errors';
import { describePerson, formatStoryContext, normalizeText, type CastPerson, type StoryContext } from '../context';
import type { CharacterKind, EngineDeps, EngineOption, NewCastMember, NewCharacter } from '../engine';
import { castToken, toCastTokenPrompt } from '../tokens';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** `{{name}}` substitution, as today's flows do it. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  return result;
}

/** The mode's curated prompt for `key` (or the engine default), in the `[[cast:id]]` format. */
export function modePrompt(ctx: StoryContext, key: string, fallback: string): string {
  return toCastTokenPrompt(ctx.mode.prompts[key] ?? fallback);
}

export function withPrefix(ctx: StoryContext, prompt: string): string {
  return ctx.globalPrefix ? `${ctx.globalPrefix}\n\n${prompt}` : prompt;
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

export type GenerateRequest<O> = {
  flowName: string;
  system?: string;
  prompt?: string;
  messages?: MessageData[];
  schema: z.ZodType<O>;
  temperature?: number;
  maxOutputTokens?: number;
  /** TEST_MODE: returned instead of calling the model. Deterministic. */
  fixture: () => O;
};

/** Pull a JSON object out of free text (```json fences or the first {...}). */
export function parseJsonFromText<O>(text: string, schema: z.ZodType<O>): O | null {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/.exec(text);
  const candidates = [fenced?.[1], text, /\{[\s\S]*\}/.exec(text)?.[0]].filter((c): c is string => !!c);
  for (const candidate of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate.trim()));
      if (parsed.success) return parsed.data;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * One structured `creation.text` call through the AI harness (model by
 * purpose, the mode's override, retries, logging). A failure is a 503 the
 * child can retry; the turn is not recorded.
 */
export async function generate<O>(deps: EngineDeps, ctx: StoryContext, request: GenerateRequest<O>): Promise<O> {
  if (deps.testMode()) return request.fixture();
  let response: { text: string; output: O | null };
  try {
    response = await deps.ai.generateText<O>({
      purpose: 'creation.text',
      creationModeModel: ctx.mode.model,
      flowName: request.flowName,
      ownerUid: ctx.ownerUid,
      system: request.system,
      prompt: request.prompt,
      messages: request.messages && request.messages.length > 0 ? request.messages : undefined,
      output: { schema: request.schema },
      config: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      },
    });
  } catch (error) {
    console.error(`[creation] ${request.flowName} failed`, (error as Error)?.message ?? error);
    throw new ServiceUnavailableError('The story helper could not answer just now. Please try again.', {
      code: 'AI_UNAVAILABLE',
      cause: error,
    });
  }
  const parsedOutput = response.output !== null && response.output !== undefined ? request.schema.safeParse(response.output) : null;
  if (parsedOutput?.success) return parsedOutput.data;
  const fromText = parseJsonFromText(response.text ?? '', request.schema);
  if (fromText) return fromText;
  console.error(`[creation] ${request.flowName}: no valid structured output`, (response.text ?? '').slice(0, 300));
  throw new ServiceUnavailableError('The story helper got muddled. Please try again.', { code: 'AI_BAD_OUTPUT' });
}

// ---------------------------------------------------------------------------
// The storyteller system message (port of src/lib/build-story-system-message.ts)
// ---------------------------------------------------------------------------

function ageAppropriateGuidance(age: number | null): string {
  if (age === null) return 'Use simple language and gentle themes suitable for young children.';
  if (age <= 3) {
    return 'Use very simple words, short sentences, and familiar concepts. Focus on sensory experiences, simple emotions, and comforting themes. Repetition is good.';
  }
  if (age <= 5) {
    return 'Use simple vocabulary with some new words to learn. Include mild adventure and problem-solving. Characters can face small challenges but always succeed with kindness and creativity.';
  }
  if (age <= 7) {
    return 'Can include more complex plots and vocabulary. Characters can face bigger challenges. Include themes of friendship, bravery, and learning from mistakes.';
  }
  if (age <= 10) {
    return 'Can handle more sophisticated narratives with plot twists. Include moral complexity and character growth. Vocabulary can be more advanced.';
  }
  return 'Can include complex themes, nuanced characters, and challenging vocabulary. Stories can explore deeper emotions and more complex problem-solving.';
}

export function ageWords(age: number | null): string {
  if (age === null) return 'young (age unknown)';
  if (age === 0) return 'under 1 year old (a baby)';
  return `${age} years old`;
}

const TOKEN_RULE = `=== CHARACTER REFERENCES ===
Refer to every character ONLY with their token exactly as listed above, e.g. ${castToken('abc123')}. Never write a listed character's name without the token. A NEW character you introduce is written by name until they join the story.`;

const BEAT_INSTRUCTIONS = `=== STORY BEAT INSTRUCTIONS ===
Your task is to continue the story and provide choices for the child.
• Generate the next paragraph of the story, building on what came before
• Provide exactly 3 choices for what happens next
• Choices should be meaningfully different and child-appropriate
• At least one choice should be actionable by the main child
• Consider including an existing character in one choice when natural
• If the story would benefit from a new character (helper, friend, magical creature), include an option that introduces one

=== SCENE ANNOTATION ===
Your output includes a "scene" field. In scene.presentActors, list the [[cast:id]] of EVERY character physically present in the scene — not just those you explicitly named. This list drives the illustration, so a missing ID means a missing character in the image.
• Explicit reference: "[[cast:abc]] jumped" → include abc
• Grammatical collapse: "they both laughed" → include both IDs
• Implied presence: "everyone cheered" → include all characters currently in the scene
• Always include the main child's ID`;

const ENDING_INSTRUCTIONS = `=== STORY ENDING INSTRUCTIONS ===
Your task is to bring the story to a satisfying conclusion.
• Wrap up the narrative threads naturally
• Give the main child a moment of triumph or warm resolution
• End on a positive, memorable note
• The ending should feel earned based on the journey`;

/** The shared storyteller system message, with the family as `[[cast:id]]` tokens. */
export function storySystemMessage(ctx: StoryContext, flow: 'story_beat' | 'ending', options: { prefix?: boolean } = {}): string {
  const age = ageWords(ctx.childAge);
  const context = formatStoryContext(ctx);
  const message = `You are a master storyteller working with a child to create a personalized, engaging story featuring that child as the protagonist.

=== STORY SUBJECT ===
${context.fullContext}

=== NARRATIVE GUIDELINES ===
• The main child is ${age}. ${ageAppropriateGuidance(ctx.childAge)}
• Feature the main child prominently as the hero of their story.
• Incorporate the child's likes into the narrative and avoid their dislikes.
• Naturally include siblings and known characters when appropriate - they add richness to the story.
• Use the pronouns specified for each character consistently.

=== CREATING NEW CHARACTERS ===
New characters enrich stories! Introduce one when:
• The protagonist needs a helper, guide, or companion to move the plot forward
• A challenge requires knowledge or abilities no existing character has
• The story has been running for several beats without fresh energy
Avoid introducing new characters near the end of a story or when existing characters haven't yet had their moment.

When introducing a NEW character (one NOT already in the lists above), you MUST provide:
1. **introducesCharacter**: Set to true
2. **newCharacterName**: A proper name for the character (e.g., "Nutsy", "Captain Sparkle", "Grandma Rose")
3. **newCharacterLabel**: A descriptive phrase with personality traits (e.g., "a friendly squirrel who loves acorns", "a brave pirate captain", "a kind elderly neighbor")
4. **newCharacterType**: One of: Family, Friend, Pet, Toy, or Other

IMPORTANT: The name and label are DIFFERENT:
- Name = What to call them (e.g., "Nutsy")
- Label = Who they are (e.g., "a friendly squirrel who loves acorns")
- WRONG: Using the same text for both, resulting in "the gnome, Gnome"
- RIGHT: Name="Bramble", Label="a wise old gnome who lives in the garden"

Character ideas that work well in children's stories:
• Talking animals with distinct personalities
• Magical creatures (fairies, friendly dragons, helpful sprites)
• Wise mentors (old owl, kind wizard, gentle giant)
• Quirky friends (clumsy robot, shy cloud, brave pebble)

=== TONE & STYLE ===
• Warm, engaging, and filled with wonder
• Use simple vocabulary appropriate for a ${age} child
• Encourage imagination, curiosity, and positive values
• Keep sentences short and rhythmic for young listeners
• Include sensory details that bring the story to life

${TOKEN_RULE}

${flow === 'story_beat' ? BEAT_INSTRUCTIONS : ENDING_INSTRUCTIONS}`;
  return options.prefix ? withPrefix(ctx, message) : message;
}

// ---------------------------------------------------------------------------
// Turns, options and inputs
// ---------------------------------------------------------------------------

export function lastPromptTurn(ctx: StoryContext): WithId<StoryTurn> | null {
  for (let i = ctx.turns.length - 1; i >= 0; i--) {
    if (ctx.turns[i].kind === 'prompt') return ctx.turns[i];
  }
  return null;
}

export function inputNotExpected(message = 'That answer does not fit this question.'): BadRequestError {
  return new BadRequestError(message, { code: 'INPUT_NOT_EXPECTED' });
}

/** The option the child chose on the last prompt (400 when there is none with that id). */
export function chosenOption(ctx: StoryContext, input: ChildInput): { id: string; text: string } {
  if (input.kind !== 'choice') throw inputNotExpected('Pick one of the choices.');
  const option = lastPromptTurn(ctx)?.options?.find((o) => o.id === input.optionId);
  if (!option) throw inputNotExpected('That choice is not on offer.');
  return { id: option.id, text: option.text };
}

/** The child's words for the model: a chosen option's text (with tokens) or typed text. */
export function inputWords(ctx: StoryContext, input: ChildInput): string {
  if (input.kind === 'text') return input.text.trim();
  if (input.kind === 'choice') return chosenOption(ctx, input).text;
  throw inputNotExpected('Pick a choice or type an answer.');
}

/** Model options → stored options (tokens normalised, empty ones dropped). */
export function toOptions(ctx: StoryContext, options: Array<{ id: string; text: string }>): EngineOption[] {
  const seen = new Set<string>();
  return options
    .map((o) => ({ id: String(o.id).trim() || 'A', text: normalizeText(ctx, o.text) }))
    .filter((o) => o.text.length > 0 && !seen.has(o.id) && (seen.add(o.id), true));
}

/** Earlier turns as chat messages: prompts are the model's, inputs the child's (words with tokens). */
export function turnsAsMessages(ctx: StoryContext, turns: WithId<StoryTurn>[] = ctx.turns): MessageData[] {
  const messages: MessageData[] = [];
  for (const turn of turns) {
    if (turn.kind === 'prompt' && turn.prompt) messages.push({ role: 'model', content: [{ text: turn.prompt }] });
    if (turn.kind === 'input') messages.push({ role: 'user', content: [{ text: turnWords(turn) }] });
  }
  return messages;
}

/** The words of a recorded child input. */
export function turnWords(turn: StoryTurn): string {
  if (!turn.input) return '';
  if (turn.input.kind === 'text') return turn.input.text;
  return turn.inputDisplay ?? '';
}

// ---------------------------------------------------------------------------
// Cast changes
// ---------------------------------------------------------------------------

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 20);
}

/**
 * Deterministic id for a character introduced on this turn: a retry of the
 * same turn (after a failed write) gets the same id.
 */
export function newCharacterId(ctx: StoryContext, seed: string): string {
  return `chr_${shortHash(`${ctx.storyId}|${ctx.nextTurnIndex}|${seed.toLowerCase()}`)}`;
}

/** Add a roster member to the cast for this turn; null if already in it or not in the family. */
export function addExistingToCast(ctx: StoryContext, castId: string, addedBy: 'child' | 'ai'): NewCastMember | null {
  if (ctx.cast.some((p) => p.castId === castId)) return null;
  const person = ctx.roster.find((p) => p.castId === castId);
  if (!person) return null;
  ctx.cast.push(person);
  return { kind: 'existing', castId, ref: person.ref, addedBy };
}

const CHARACTER_KINDS: CharacterKind[] = ['Family', 'Friend', 'Pet', 'Toy', 'Other'];

export function characterKind(value: unknown): CharacterKind {
  return CHARACTER_KINDS.find((k) => k.toLowerCase() === String(value ?? '').trim().toLowerCase()) ?? 'Friend';
}

/** Today's extractDisplayName: the explicit name, else a word from the label. */
export function displayNameFrom(label: string, explicitName?: string | null): string {
  if (explicitName?.trim()) return explicitName.trim();
  const a = /^a\s+(?:.*?\s+)?(\w+)(?:\s+who|\s+that|\s*$)/i.exec(label);
  if (a) return a[1].charAt(0).toUpperCase() + a[1].slice(1);
  const the = /^(\w+)\s+the\s+/i.exec(label);
  if (the) return the[1];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const profileSchema = z.object({
  description: z.string(),
  age: z.number().optional(),
  pronouns: z.enum(['he/him', 'she/her', 'they/them']),
  likes: z.array(z.string()).min(1).max(6),
  dislikes: z.array(z.string()).min(1).max(4),
});

/**
 * The AI introduces a character (port of createStoryCharacterFlow +
 * generateCharacterProfile): a profile is generated, the character gets a
 * deterministic id and joins the cast. The service creates the `characters`
 * document (`origin: 'story'`) in the same transaction as the turn.
 */
export async function introduceCharacter(
  deps: EngineDeps,
  ctx: StoryContext,
  intro: { name?: string | null; label?: string | null; type?: unknown; storyContext: string }
): Promise<NewCastMember> {
  const label = intro.label?.trim() || 'A new friend';
  const displayName = displayNameFrom(label, intro.name);
  const type = characterKind(intro.type);
  const ageContext =
    ctx.childAge === null ? '' : ctx.childAge === 0 ? 'The main character (child) is under 1 year old (a baby).' : `The main character (child) is ${ctx.childAge} years old.`;
  const prompt = `Generate a character profile for a children's story character.

Character: ${displayName}
Type: ${type}
Description: ${label}
Story Context: ${intro.storyContext}
${ageContext}

Create an age-appropriate, imaginative character profile that would fit naturally into a children's story. The character should be friendly, engaging, and appropriate for young children.

For pronouns:
- Infer pronouns from the character's name, description, and type
- Use "they/them" if gender is unclear or if the character is non-binary
- Pets and toys may use he/him, she/her, or they/them based on context

For the age:
- Pets and toys: don't assign a specific age
- Adult characters (family, friends): choose an appropriate adult age
- Child characters: make them around the same age as the main character, or slightly older/younger

Generate realistic, story-appropriate likes and dislikes that match the character's personality and role.`;

  let profile: z.infer<typeof profileSchema>;
  try {
    profile = await generate(deps, ctx, {
      flowName: `${ctx.modeId}.characterProfile`,
      prompt,
      schema: profileSchema,
      fixture: () => ({ description: `${label}.`, pronouns: 'they/them', likes: ['adventures', 'friends', 'snacks'], dislikes: ['rain', 'loud noises'] }),
    });
  } catch {
    // As today: a failed profile never blocks the story.
    profile = { description: `A ${label} who appears in the story`, pronouns: 'they/them', likes: [], dislikes: [] };
  }
  let dateOfBirth: string | null = null;
  if (profile.age && profile.age > 0 && type !== 'Pet' && type !== 'Toy') {
    const now = ctx.now;
    dateOfBirth = new Date(Date.UTC(now.getUTCFullYear() - Math.round(profile.age), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  const character: NewCharacter = {
    displayName,
    type,
    label,
    pronouns: profile.pronouns,
    description: profile.description,
    likes: profile.likes,
    dislikes: profile.dislikes,
    dateOfBirth,
  };
  const castId = newCharacterId(ctx, displayName);
  const person: CastPerson = {
    castId,
    ref: { kind: 'character', id: castId },
    displayName,
    pronouns: character.pronouns,
    description: character.description,
    likes: character.likes,
    dislikes: character.dislikes,
    characterType: type,
    relationship: null,
    age: profile.age ?? null,
    dateOfBirth: dateOfBirth ? dateOfBirth.split('T')[0] : null,
    appearance: null,
    isHero: false,
    scopedChildId: ctx.childId,
    origin: 'story',
    usageCount: 1,
    lastUsedMs: ctx.now.getTime(),
  };
  if (!ctx.roster.some((p) => p.castId === castId)) ctx.roster.push(person);
  if (!ctx.cast.some((p) => p.castId === castId)) ctx.cast.push(person);
  return { kind: 'new', castId, character, addedBy: 'ai' };
}

/** A short story-so-far for character profiles: the last prompt's words. */
export function recentStory(ctx: StoryContext): string {
  const last = lastPromptTurn(ctx);
  return last?.promptDisplay?.slice(0, 600) || `A story about ${ctx.hero.displayName}.`;
}

export { describePerson };
