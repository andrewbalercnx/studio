/**
 * Prompt text for cast sheets and page art, ported from
 * story-exemplar-generation-flow.ts (reference sheets) and story-image-flow.ts
 * (createImage). Pure functions: the job handlers fetch the images and call the
 * AI harness.
 *
 * Changes from today:
 * - Characters are named by display name, not `$$id$$`, and only the page's
 *   `presentCast` is described (no scraping of page text).
 * - Cast sheets are drawn from the portrait (or original photos while there is
 *   no portrait) plus the appearance text; never from `avatarUrl` (ADR-0006).
 */
import type { Scene } from '../data/schemas/manuscript';
import type { CastEntry } from './cast';

// ---------------------------------------------------------------------------
// Cast sheet
// ---------------------------------------------------------------------------

export type CastSheetSource = 'portrait' | 'photos' | 'appearance';

export function buildCastSheetPrompt(input: {
  member: CastEntry;
  stylePrompt: string;
  styleExampleCount: number;
  source: CastSheetSource;
  referenceCount: number;
  synopsis: string | null;
  heroAge: string | null;
}): string {
  const { member } = input;
  const appearance = [
    member.likeness.appearance ? `Physical appearance: ${member.likeness.appearance}` : null,
    member.description ? `Description: ${member.description}` : null,
    member.likes.length ? `Likes: ${member.likes.join(', ')}` : null,
  ].filter(Boolean);
  const type = member.characterType ? ` (${member.characterType.toLowerCase()})` : '';
  const firstReference = input.styleExampleCount + 1;
  const references =
    input.referenceCount === 0
      ? 'There is no photo of this character: draw them from the written appearance above, consistently in all four views.'
      : input.source === 'portrait'
        ? `IDENTITY REFERENCE: image ${firstReference} is a portrait of this character. Keep their face, hair, skin tone and build recognisably the same, rendered in the art style.`
        : `IDENTITY REFERENCE: images ${firstReference}-${firstReference + input.referenceCount - 1} are photos of this character. Keep their face, hair, skin tone and build recognisably the same, rendered in the art style.`;

  return `Create a character reference sheet for a children's storybook character.

=== ART STYLE (CRITICAL - MUST FOLLOW EXACTLY) ===
${input.stylePrompt}

${input.styleExampleCount > 0 ? `STYLE REFERENCE IMAGES: The first ${input.styleExampleCount} image(s) show the EXACT art style you must use. Replicate:` : 'Apply this art style consistently:'}
- The exact rendering technique (watercolor, digital, pencil, realistic, etc.)
- Color palette, saturation levels, and color harmony
- Line weight, edge treatment, and outline style
- Level of detail, texture, and shading approach
- Overall aesthetic, mood, and visual tone

=== CHARACTER TO DEPICT ===
Name: ${member.displayName}${type}
Pronouns: ${member.pronouns ?? 'they/them'}${appearance.length ? `\n\n${appearance.join('\n')}` : ''}

${references}
${input.synopsis ? `\n=== STORY CONTEXT ===\nThis character appears in a story with this synopsis:\n${input.synopsis}\n\nChoose clothing and accessories appropriate for this story's setting.\n` : ''}
=== REFERENCE SHEET LAYOUT (CRITICAL) ===
A SQUARE image divided into 4 EQUAL QUADRANTS (2 rows × 2 columns):
1. TOP-LEFT: FACE CLOSE-UP — head and shoulders only, the most important view (eyes, eyebrows, nose, mouth, ears in clear detail)
2. TOP-RIGHT: full body FRONT view, simple standing pose
3. BOTTOM-LEFT: full body 3/4 view
4. BOTTOM-RIGHT: full body BACK view

=== STRICT REQUIREMENTS ===
1. Plain WHITE or very light neutral background — no scenery, no props, no text
2. All four views show the EXACT SAME character: identical face, hair, skin tone, clothing and proportions
3. Neutral standing poses for the full-body views
4. ${input.heroAge ? `Make the character appealing and appropriate for a child who is ${input.heroAge}.` : 'Make the character appealing and appropriate for young children.'}
5. Each quadrant clearly separated with equal spacing

This sheet keeps the character consistent across every illustration in the book.`;
}

// ---------------------------------------------------------------------------
// Page art
// ---------------------------------------------------------------------------

/** Prompt levels, one per job attempt (story-image-flow's progressive simplification). */
export type ArtPromptLevel = 'full' | 'noStyleImages' | 'minimal';

export function artLevelForAttempt(attempt: number): ArtPromptLevel {
  if (attempt <= 1) return 'full';
  if (attempt === 2) return 'noStyleImages';
  return 'minimal';
}

export type PresentMember = {
  member: CastEntry;
  action: string;
  /** Index (1-based) of this member's reference image among all attached images, or null. */
  referenceImage: number | null;
  /** What the reference image is. */
  referenceKind: 'castSheet' | 'portrait' | 'photo' | null;
};

export type PagePromptInput = {
  kind: 'cover' | 'story';
  scene: Scene;
  present: PresentMember[];
  stylePrompt: string;
  styleImageCount: number;
  globalPrefix: string | null;
  title: string | null;
  heroName: string | null;
  heroAge: string | null;
  level: ArtPromptLevel;
};

function sceneBlock(scene: Scene, present: PresentMember[]): string {
  const count = present.length;
  const countWord = count === 1 ? '1 character' : `${count} characters`;
  const lines = present.map((p) => `• ${p.member.displayName}: ${p.action}`).join('\n');
  if (count === 0) {
    return `Location: ${scene.location}\nAtmosphere: ${scene.mood}\n\nNo characters appear in this illustration.`;
  }
  return `Location: ${scene.location}
Atmosphere: ${scene.mood}

Characters in this scene (EXACTLY ${countWord} — no other people or figures):
${lines}

IMPORTANT: Only the ${countWord} listed above may appear in this illustration. Do not add any other people, children, figures, crowd members, or background characters.`;
}

function characterDetails(present: PresentMember[]): string {
  const details = present.map((p) => ({
    name: p.member.displayName,
    role: p.member.role === 'hero' ? 'main character' : p.member.characterType ?? 'supporting character',
    pronouns: p.member.pronouns ?? undefined,
    appearance: p.member.likeness.appearance ?? undefined,
    description: p.member.description ?? undefined,
  }));
  return JSON.stringify(details, null, 2);
}

export function buildPagePrompt(input: PagePromptInput): string {
  const parts: string[] = [];
  if (input.globalPrefix) parts.push(input.globalPrefix);

  if (input.level === 'minimal') {
    parts.push(`Art Style: ${input.stylePrompt}`);
    parts.push(`Scene: ${sceneBlock(input.scene, input.present)}`);
    if (input.kind === 'cover' && input.title) parts.push(`This is the front cover; include the title "${input.title}" in large, clear letters at the top.`);
    return parts.join('\n\n');
  }

  if (input.kind === 'cover') {
    const author = input.heroName ? `by ${input.heroName}` : null;
    parts.push(`Create a FRONT COVER for a personalized children's storybook.
${input.title ? `
=== TITLE TEXT (MUST BE INCLUDED) ===
The cover MUST include this exact title text: "${input.title}"
${author ? `Below the title, include the author credit: "${author}"` : ''}

TEXT RENDERING REQUIREMENTS:
- Place the title prominently at the TOP of the image
- Use large, clear, LEGIBLE letters that a child can read, in a fun, rounded, child-friendly font
- Make each letter distinct and well-formed; use contrasting colors so the text stands out
- Double-check spelling: the title is "${input.title}" - spell it exactly${author ? '\n- Place the author credit smaller, below the title' : ''}
` : '\nLeave space at the top for a title.\n'}
ILLUSTRATION REQUIREMENTS:
- Show the main character(s) in a dynamic, engaging pose
- Capture the story's spirit and invite readers in
- Make it eye-catching and appealing to both children and parents`);
    parts.push(sceneBlock(input.scene, input.present));
  } else {
    parts.push(
      input.heroName && input.heroAge
        ? `Create an image for a child's storybook. The main child (${input.heroName}) is ${input.heroAge}. Create an image of the following scene, suitable for a child of this age.`
        : `Create an image for a child's storybook.`
    );
    parts.push(`Scene: ${sceneBlock(input.scene, input.present)}`);
  }

  const styleImages = input.level === 'full' ? input.styleImageCount : 0;
  parts.push(
    styleImages > 0
      ? `Art Style: ${input.stylePrompt}\n\nIMPORTANT: Use the first ${styleImages} image(s) provided as visual style reference. Match their artistic style, color palette, line weight, and overall aesthetic closely.`
      : `Art Style: ${input.stylePrompt}`
  );

  const withReferences = input.present.filter((p) => p.referenceImage !== null);
  if (input.present.length > 0) {
    if (withReferences.length > 0) {
      const mapping = withReferences
        .map((p) => `- Image ${p.referenceImage}: ${p.member.displayName}${p.referenceKind === 'castSheet' ? ' (character reference sheet)' : ''}`)
        .join('\n');
      const usesSheets = withReferences.some((p) => p.referenceKind === 'castSheet');
      parts.push(`IMPORTANT: The images after the style examples are CHARACTER REFERENCES.

IMAGE-TO-CHARACTER MAPPING (use the correct reference for each character):
${mapping}
${usesSheets ? `
Each reference sheet is a 2x2 grid: TOP-LEFT face close-up (use it for facial features), TOP-RIGHT front view, BOTTOM-LEFT 3/4 view, BOTTOM-RIGHT back view.
` : ''}
CRITICAL: Match each character's facial features (eyes, nose, mouth, hair, skin tone) EXACTLY as shown in their reference. The face must be recognizably the same person, rendered in the art style.`);
    }
    parts.push(`Characters in this scene:\n${characterDetails(input.present)}`);
  }
  return parts.join('\n\n');
}
