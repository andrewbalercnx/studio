
'use server';

/**
 * @fileOverview A Genkit flow to generate a synopsis for a story.
 * The synopsis uses $$id$$ placeholders for all actors (child, characters).
 * Runs in the background after story compilation.
 */

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { Story, ChildProfile, Character } from '@/lib/types';
import { logAIFlow } from '@/lib/ai-flow-logger';
import {
  type ActorInfo,
  childProfileToActorInfo,
  characterToActorInfo,
  buildActorListForPrompt,
} from '@/lib/story-context-builder';

const StorySynopsisFlowInputSchema = z.object({
  storyId: z.string(),
  forceRegenerate: z.boolean().optional(),
});

export type StorySynopsisFlowInput = z.infer<typeof StorySynopsisFlowInputSchema>;

const StorySynopsisFlowOutputSchema = z.object({
  ok: z.boolean(),
  synopsis: z.string().optional(),
  actors: z.array(z.string()).optional(),
  errorMessage: z.string().optional(),
});

export type StorySynopsisFlowOutput = z.infer<typeof StorySynopsisFlowOutputSchema>;

/**
 * Extract all $$id$$ and $id$ placeholders from text
 * Supports both double-dollar (correct) and single-dollar (AI fallback) formats
 */
function extractActorIds(text: string): string[] {
  const ids = new Set<string>();
  // Double $$ format (correct format)
  const doubleRegex = /\$\$([a-zA-Z0-9_-]+)\$\$/g;
  let match;
  while ((match = doubleRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  // Single $ format (fallback for AI that didn't follow instructions)
  // Only match IDs that look like Firestore document IDs (15+ alphanumeric chars)
  const singleRegex = /\$([a-zA-Z0-9_-]{15,})\$/g;
  while ((match = singleRegex.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

export const storySynopsisFlow = ai.defineFlow(
  {
    name: 'storySynopsisFlow',
    inputSchema: StorySynopsisFlowInputSchema,
    outputSchema: StorySynopsisFlowOutputSchema,
  },
  async ({ storyId, forceRegenerate }) => {
    const firestore = await getServerFirestore();
    const storyRef = firestore.collection('stories').doc(storyId);

    try {
      // Load story
      const storyDoc = await storyRef.get();
      if (!storyDoc.exists) {
        return { ok: false, errorMessage: `Story ${storyId} not found.` };
      }

      const story = storyDoc.data() as Story;

      // Check if already generated (unless forcing)
      if (!forceRegenerate && story.synopsis && story.synopsisGeneration?.status === 'ready') {
        return { ok: true, synopsis: story.synopsis, actors: story.actors };
      }

      // Mark as generating
      await storyRef.update({
        'synopsisGeneration.status': 'generating',
        'synopsisGeneration.lastRunAt': FieldValue.serverTimestamp(),
      });

      // Extract all actor IDs from the story text
      const actorIds = extractActorIds(story.storyText);

      // Make sure the child is included as an actor
      if (!actorIds.includes(story.childId)) {
        actorIds.unshift(story.childId);
      }

      // Load main child profile
      const childRef = firestore.collection('children').doc(story.childId);
      const childDoc = await childRef.get();
      const mainChild = childDoc.exists ? (childDoc.data() as ChildProfile) : null;

      // Get other actor IDs (excluding main child)
      const otherActorIds = actorIds.filter(id => id !== story.childId);

      // Load from both children (siblings) and characters collections
      const [childDocs, characterDocs] = await Promise.all([
        // Load from children collection (siblings)
        otherActorIds.length > 0
          ? Promise.all(otherActorIds.map(id => firestore.collection('children').doc(id).get()))
          : [],
        // Load from characters collection
        otherActorIds.length > 0
          ? Promise.all(otherActorIds.map(id => firestore.collection('characters').doc(id).get()))
          : [],
      ]);

      // Build maps of found entities
      const siblingMap = new Map<string, ChildProfile>();
      childDocs.forEach(doc => {
        if (doc.exists) {
          siblingMap.set(doc.id, { id: doc.id, ...doc.data() } as ChildProfile);
        }
      });

      const characterMap = new Map<string, Character & { id: string }>();
      characterDocs.forEach(doc => {
        if (doc.exists) {
          characterMap.set(doc.id, { id: doc.id, ...doc.data() } as Character & { id: string });
        }
      });

      // Build full actor list using shared utility
      const actors: ActorInfo[] = [];

      // Add main child first
      if (mainChild) {
        actors.push(childProfileToActorInfo({ ...mainChild, id: story.childId }, true));
      }

      // Add other actors (siblings and characters)
      for (const actorId of otherActorIds) {
        const sibling = siblingMap.get(actorId);
        if (sibling) {
          actors.push(childProfileToActorInfo(sibling, false));
          continue;
        }

        const character = characterMap.get(actorId);
        if (character) {
          actors.push(characterToActorInfo(character));
        }
      }

      // Build detailed actor list for the prompt
      const fullActorDescriptions = buildActorListForPrompt(actors);

      // Build ID to name mapping for the model
      const idToNameMapping = actors.map(actor =>
        `$$${actor.id}$$ = ${actor.displayName}`
      ).join('\n');

      // Build prompt with full actor details
      const storyPreview = story.storyText.slice(0, 2000);

      const prompt = `You are a children's book editor. Generate a short, engaging synopsis for this story.

CHARACTERS IN THIS STORY (with full details):
${fullActorDescriptions}

ID REFERENCE (use these exact IDs in your synopsis):
${idToNameMapping}

STORY TEXT:
${storyPreview}

TASK: Write a 2-3 sentence synopsis that:
1. Summarizes the main adventure in an exciting way
2. Is appropriate for young children (ages 3-7)
3. Uses the $$id$$ placeholder format for ALL character names

CRITICAL: You MUST use the exact $$id$$ format for every character reference. Never use the character's actual name.
- Correct: "$$${story.childId}$$ discovers a magical garden"
- Wrong: "${mainChild?.displayName || 'The child'} discovers a magical garden"

OUTPUT: Return ONLY the synopsis text (no quotes, no labels, just the synopsis).`;

      let llmResponse;
      const startTime = Date.now();
      const modelName = 'googleai/gemini-2.5-flash';
      try {
        llmResponse = await ai.generate({
          model: modelName,
          prompt,
          config: { temperature: 0.6, maxOutputTokens: 200 },
        });
        await logAIFlow({ flowName: 'storySynopsisFlow', sessionId: storyId, parentId: story.parentUid, prompt, response: llmResponse, startTime, modelName });
      } catch (e: any) {
        await logAIFlow({ flowName: 'storySynopsisFlow', sessionId: storyId, parentId: story.parentUid, prompt, error: e, startTime, modelName });
        throw e;
      }

      const synopsis = llmResponse.text?.trim() || 'A wonderful adventure awaits!';

      // Update story with generated synopsis and actors list
      await storyRef.update({
        synopsis,
        actors: actorIds,
        'synopsisGeneration.status': 'ready',
        'synopsisGeneration.lastCompletedAt': FieldValue.serverTimestamp(),
        'synopsisGeneration.lastErrorMessage': null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, synopsis, actors: actorIds };

    } catch (e: any) {
      console.error('[storySynopsisFlow] Error:', e);

      // Mark as error
      await storyRef.update({
        'synopsisGeneration.status': 'error',
        'synopsisGeneration.lastErrorMessage': e.message || 'Unknown error',
      });

      return { ok: false, errorMessage: e.message || 'Failed to generate synopsis.' };
    }
  }
);
