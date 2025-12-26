import { z } from 'zod';

// === Option Schema ===
// Note: Using .optional() only (not .nullable()) to reduce JSON Schema nesting depth
// Gemini has a maximum nesting depth limit for schemas
export const StoryBeatOptionSchema = z.object({
  id: z.string().describe("A single uppercase letter: 'A', 'B', or 'C'"),
  text: z.string().describe("A short, child-friendly choice for what happens next"),
  introducesCharacter: z.boolean().optional()
    .describe("Set to true if this option introduces a new character"),
  newCharacterName: z.string().optional()
    .describe("The character's proper name (e.g., 'Nutsy', 'Captain Sparkle')"),
  newCharacterLabel: z.string().optional()
    .describe("A descriptive phrase (e.g., 'a friendly squirrel who loves acorns')"),
  newCharacterType: z.enum(['Family', 'Friend', 'Pet', 'Toy', 'Other']).optional()
    .describe("The type of character being introduced"),
  existingCharacterId: z.string().optional()
    .describe("If referencing an existing character, their ID"),
  avatarUrl: z.string().optional()
    .describe("Avatar URL for existing characters"),
});

// === Main Output Schema ===
export const StoryBeatOutputSchema = z.object({
  storyContinuation: z.string()
    .describe("The next paragraph of the story, continuing from the story so far"),
  options: z.array(StoryBeatOptionSchema).min(3).max(3)
    .describe("Exactly 3 choices for the child")
});

// === Type Inference ===
export type StoryBeatOutput = z.infer<typeof StoryBeatOutputSchema>;
export type StoryBeatOption = z.infer<typeof StoryBeatOptionSchema>;

// === Human-Readable Description Generator ===
export function generateStoryBeatOutputDescription(): string {
  return `{
  "storyContinuation": "The next paragraph of the story",
  "options": [
    {
      "id": "A | B | C",
      "text": "A short, child-friendly choice",
      "introducesCharacter": true (only if introducing new character),
      "newCharacterName": "The character's name (required if introducesCharacter)",
      "newCharacterLabel": "Description of who they are (required if introducesCharacter)",
      "newCharacterType": "Family | Friend | Pet | Toy | Other (required if introducesCharacter)",
      "existingCharacterId": "ID of existing character (if referencing one)"
    }
  ]
}`;
}

// === Validation Helper ===
export function validateStoryBeatOutput(data: unknown):
  { success: true; data: StoryBeatOutput } |
  { success: false; errors: z.ZodIssue[] } {
  const result = StoryBeatOutputSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}
