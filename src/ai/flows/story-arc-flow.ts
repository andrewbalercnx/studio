
'use server';

/**
 * @fileOverview A Genkit flow that acts as a story arc engine.
 * It determines the next step in a story's arc based on the current session state.
 */

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { z } from 'genkit';
import type { StoryType, Character, ArcStep } from '@/lib/types';

/**
 * Normalizes arc steps to handle both legacy string format and new ArcStep object format.
 */
function normalizeArcSteps(steps: (string | ArcStep)[]): ArcStep[] {
  return steps.map(step =>
    typeof step === 'string'
      ? { id: step, label: step.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
      : step
  );
}

// Zod schema for the flow input
const StoryArcInputSchema = z.object({
  sessionId: z.string(),
  storyTypeId: z.string(),
  arcStepIndex: z.number().int().min(0),
  storySoFar: z.string().optional(),
  characterRoster: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })).optional(),
  basicPlot: z.string().optional().default('Overcoming the Monster'),
});

// Zod schema for the flow output
const StoryArcOutputSchema = z.object({
  nextArcStep: z.string().describe("The machine-readable label for the next step in the story arc."),
  plotGuidance: z.string().describe("One to two short sentences of guidance for how this step fits the chosen basic plot."),
  arcComplete: z.boolean().describe("Whether the story arc has been completed."),
});

// Zod schema for the guidance-generation prompt
const PlotGuidancePromptInputSchema = z.object({
    nextArcStep: z.string(),
    basicPlot: z.string(),
});


export const storyArcEngineFlow = ai.defineFlow(
  {
    name: 'storyArcEngineFlow',
    inputSchema: StoryArcInputSchema,
    outputSchema: StoryArcOutputSchema,
  },
  async (input) => {
    const { firestore } = initializeFirebase();
    const { storyTypeId, arcStepIndex, basicPlot } = input;

    // 1. Validation: Ensure storyTypeId exists
    const storyTypeRef = doc(firestore, 'storyTypes', storyTypeId);
    const storyTypeDoc = await getDoc(storyTypeRef);

    if (!storyTypeDoc.exists()) {
      throw new Error(`StoryType with id "${storyTypeId}" not found.`);
    }
    const storyType = storyTypeDoc.data() as StoryType;
    const rawArcTemplate = storyType.arcTemplate?.steps;

    if (!rawArcTemplate || rawArcTemplate.length === 0) {
        throw new Error(`StoryType "${storyTypeId}" has no arc template steps defined.`);
    }

    // Normalize for backward compatibility with legacy string format
    const arcTemplate = normalizeArcSteps(rawArcTemplate);

    // 2. Logic: Map arcStepIndex to the arc sequence
    if (arcStepIndex >= arcTemplate.length) {
        throw new Error(`arcStepIndex ${arcStepIndex} is out of bounds for story type "${storyTypeId}" which has ${arcTemplate.length} steps.`);
    }

    const nextArcStepIndex = arcStepIndex;
    const nextArcStepObj = arcTemplate[nextArcStepIndex];
    const nextArcStep = nextArcStepObj.id;

    // 3. Logic: Detect arc completion
    const arcComplete = nextArcStepIndex >= arcTemplate.length - 1;
    
    // 4. Logic: Generate plot guidance
    // If the arc step has built-in guidance, use it; otherwise generate with AI
    let plotGuidance: string;

    if (nextArcStepObj.guidance) {
        // Use the author-provided guidance
        plotGuidance = nextArcStepObj.guidance;
    } else {
        // Fall back to AI-generated guidance
        const plotGuidancePrompt = ai.definePrompt({
            name: 'plotGuidancePrompt',
            input: { schema: PlotGuidancePromptInputSchema },
            prompt: `You are a master storyteller who understands plot structures.
            Given a story beat label and a basic plot type, provide one to two short sentences of guidance for a creative AI on how to write this step.

            CONTEXT:
            Basic Plot Type: {{{basicPlot}}}
            Current Story Beat: {{{nextArcStep}}}

            Guidance:
            `,
        });

        const guidanceResponse = await plotGuidancePrompt({ nextArcStep, basicPlot });
        plotGuidance = guidanceResponse.text.trim();
    }

    // 5. Return the structured output
    return {
      nextArcStep,
      plotGuidance,
      arcComplete,
    };
  }
);
