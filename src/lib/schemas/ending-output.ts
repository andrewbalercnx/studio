import { z } from 'zod';

// === Ending Option Schema ===
// Note: Using .optional() only (not .nullable()) to reduce JSON Schema nesting depth
// Gemini has a maximum nesting depth limit for schemas
export const EndingOptionSchema = z.object({
  id: z.string().describe("A single uppercase letter: 'A', 'B', or 'C'"),
  text: z.string().describe("Two to three short sentences providing a gentle, happy ending to the story"),
});

// === Main Output Schema ===
export const EndingOutputSchema = z.object({
  endings: z.array(EndingOptionSchema).min(3).max(3)
    .describe("Exactly 3 possible endings for the story")
});

// === Type Inference ===
export type EndingOutput = z.infer<typeof EndingOutputSchema>;
export type EndingOption = z.infer<typeof EndingOptionSchema>;

// === Human-Readable Description Generator ===
// Used for legacy code paths that need text-based output format in the prompt
export function generateEndingOutputDescription(): string {
  return `{
  "endings": [
    { "id": "A", "text": "ending one in 2-3 short sentences" },
    { "id": "B", "text": "ending two in 2-3 short sentences" },
    { "id": "C", "text": "ending three in 2-3 short sentences" }
  ]
}`;
}

// === Validation Helper ===
export function validateEndingOutput(data: unknown):
  { success: true; data: EndingOutput } |
  { success: false; errors: z.ZodIssue[] } {
  const result = EndingOutputSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}
