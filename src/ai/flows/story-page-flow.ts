

'use server';

import { ai } from '@/ai/genkit';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerFirestore } from '@/lib/server-firestore';
import { z } from 'genkit';
import type { Story, StorySession, ChildProfile, Character, StoryBookPage as StoryBookPageType, StoryOutputType } from '@/lib/types';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { logServerSessionEvent as logSessionEvent } from '@/lib/session-events.server';
import {
  resolveEntitiesInText,
  replacePlaceholdersInText as replacePlaceholders,
  getEntitiesInText,
} from '@/lib/resolve-placeholders.server';
import { storyPaginationFlow } from './story-pagination-flow';


type EntityMap = Map<string, { displayName: string; document: Character | ChildProfile }>;

type StoryPageFlowDiagnostics = {
  stage: 'init' | 'loading' | 'chunking' | 'building_pages' | 'done' | 'error';
  details: Record<string, unknown>;
};

const PageLayoutSchema = z.object({
  aspectRatio: z.enum(['square', 'portrait', 'landscape']).optional(),
  textPlacement: z.enum(['top', 'bottom']).optional(),
});

const FlowPageSchema = z.object({
  pageNumber: z.number().int().nonnegative(),
  kind: z.enum(['cover_front', 'cover_back', 'title_page', 'text', 'image', 'blank']),
  title: z.string().optional(),
  bodyText: z.string().optional(),
  displayText: z.string().optional(),
  entityIds: z.array(z.string()).optional(),
  imageDescription: z.string().optional(),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  layoutHints: PageLayoutSchema.optional(),
});

type FlowPage = z.infer<typeof FlowPageSchema>;

function extractEntityIds(text: string): string[] {
  if (!text) return [];
  const matches = [...text.matchAll(/\$\$([^$]+)\$\$/g)];
  const ids = matches.map((match) => match[1]);
  return [...new Set(ids)]; // Return unique IDs
}

/**
 * Format a date in a friendly, child-appropriate way
 * e.g., "December 19th, 2025"
 */
function formatFriendlyDate(date: Date = new Date()): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const day = date.getDate();
  const suffix = (day === 1 || day === 21 || day === 31) ? 'st'
    : (day === 2 || day === 22) ? 'nd'
    : (day === 3 || day === 23) ? 'rd'
    : 'th';
  return `${months[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`;
}

/**
 * Calculate child's age in years from date of birth
 */
function getChildAgeYears(child?: ChildProfile | null): number | null {
  if (!child?.dateOfBirth) return null;
  let dob: Date | null = null;
  if (typeof (child.dateOfBirth as any).toDate === 'function') {
    dob = (child.dateOfBirth as any).toDate();
  } else {
    const parsed = new Date(child.dateOfBirth as any);
    dob = isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

function splitSentences(storyText: string): string[] {
  if (!storyText || typeof storyText !== 'string') return [];
  const sanitized = storyText.replace(/\s+/g, ' ').trim();
  if (!sanitized) return [];
  const parts = sanitized.match(/[^.!?]+[.!?]?/g);
  if (!parts) {
    return [sanitized];
  }
  return parts.map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Chunk sentences into pages.
 * @param sentences - Array of sentences to chunk
 * @param targetPageCount - Target number of content pages (0 = unconstrained, uses natural chunking up to 16 pages)
 */
function chunkSentences(sentences: string[], targetPageCount = 0): string[][] {
  if (sentences.length === 0) return [];

  // If targetPageCount is 0, use unconstrained mode with max 16 pages
  const maxChunks = targetPageCount > 0 ? targetPageCount : 16;

  // First pass: create natural chunks based on word count (~25 words per chunk)
  let chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  sentences.forEach(sentence => {
    const sentenceWordCount = sentence.split(/\s+/).length;
    if (currentWordCount + sentenceWordCount > 25 && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [sentence];
      currentWordCount = sentenceWordCount;
    } else {
      currentChunk.push(sentence);
      currentWordCount += sentenceWordCount;
    }
  });

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // If we have a specific target and too few chunks, split larger chunks
  if (targetPageCount > 0 && chunks.length < targetPageCount) {
    while (chunks.length < targetPageCount && chunks.some(c => c.length > 1)) {
      // Find the largest chunk to split
      let largestIdx = 0;
      let largestLen = 0;
      chunks.forEach((chunk, idx) => {
        if (chunk.length > largestLen) {
          largestLen = chunk.length;
          largestIdx = idx;
        }
      });

      if (largestLen <= 1) break; // Can't split further

      const toSplit = chunks[largestIdx];
      const midpoint = Math.ceil(toSplit.length / 2);
      const firstHalf = toSplit.slice(0, midpoint);
      const secondHalf = toSplit.slice(midpoint);

      chunks.splice(largestIdx, 1, firstHalf, secondHalf);
    }
  }

  // If we have too many chunks, merge them down to the target
  while (chunks.length > maxChunks) {
    const merged: string[][] = [];
    for (let i = 0; i < chunks.length; i += 2) {
      if (i + 1 < chunks.length) {
        merged.push([...chunks[i], ...chunks[i + 1]]);
      } else {
        merged.push(chunks[i]);
      }
    }
    chunks = merged;
  }

  return chunks;
}

/**
 * Build a detailed actor block for image prompts
 * Includes description, pronouns, likes, dislikes, and reference image URLs
 */
function buildActorBlock(
  actor: Character | ChildProfile,
  actorId: string
): string {
  const lines: string[] = [];
  lines.push(`$$${actorId}$$:`);

  if (actor.description) {
    lines.push(`- Description: ${actor.description}`);
  }

  lines.push(`- Pronouns: ${actor.pronouns ?? 'they/them'}`);

  if (actor.likes?.length) {
    lines.push(`- Likes: ${actor.likes.join(', ')}`);
  }

  if (actor.dislikes?.length) {
    lines.push(`- Dislikes: ${actor.dislikes.join(', ')}`);
  }

  // Reference images (avatar and photos)
  const imageUrls: string[] = [];
  if (actor.avatarUrl) imageUrls.push(actor.avatarUrl);
  if (actor.photos?.length) imageUrls.push(...actor.photos);

  if (imageUrls.length) {
    lines.push(`- Reference images: ${imageUrls.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Build character description for image prompts
 */
function buildCharacterDetails(characters: Character[]): string {
  return characters.map(c => {
    const likes = c.likes?.length ? ` who likes ${c.likes.join(', ')}` : '';
    const description = c.description ? ` (${c.description})` : '';
    return `${c.displayName} (${c.type}${likes})${description}`;
  }).join('; ');
}

/**
 * Build image prompt for a content page (uses page text and actors on that page)
 * New structured format with full actor details
 * Actors can be Characters (pets, friends, etc.) or ChildProfiles (siblings)
 *
 * @param text - The page text (used as fallback if no imageDescription)
 * @param child - The main child profile
 * @param storyTitle - The story title
 * @param actorsOnPage - Characters and siblings appearing on this page
 * @param pageEntityIds - Entity IDs mentioned on this page
 * @param imageDescription - AI-generated image description (preferred over text)
 */
function buildImagePrompt(
  text: string,
  child?: ChildProfile | null,
  storyTitle?: string | null,
  actorsOnPage: (Character | ChildProfile)[] = [],
  pageEntityIds: string[] = [],
  imageDescription?: string
): string {
  const childAge = child ? getChildAgeYears(child) : null;
  const childAgeText = childAge ? `${childAge} years old` : 'a young child';

  // Use imageDescription if available (from AI pagination), otherwise fall back to page text
  const sceneDescription = imageDescription || text;
  let prompt = `Create an image, with no text, that describes this scene: ${sceneDescription}\n\n`;

  if (child) {
    prompt += `The story is being created for $$${child.id}$$, age ${childAgeText}.\n\n`;
  }

  prompt += `The scene contains the following characters:\n\n`;

  // Add main child as first actor if in this page's entity list
  if (child && pageEntityIds.includes(child.id)) {
    prompt += buildActorBlock(child, child.id) + '\n\n';
  }

  // Add all other actors on this page (characters and siblings)
  for (const actor of actorsOnPage) {
    if (actor.id && actor.id !== child?.id) {
      prompt += buildActorBlock(actor, actor.id) + '\n\n';
    }
  }

  return prompt.trim();
}

/**
 * Build image prompt for the front cover (uses synopsis and ALL actors)
 * New structured format with full actor details
 * Actors can be Characters (pets, friends, etc.) or ChildProfiles (siblings)
 */
function buildFrontCoverImagePrompt(
  synopsis: string | null | undefined,
  storyTitle: string,
  child?: ChildProfile | null,
  allActors: (Character | ChildProfile)[] = []
): string {
  const synopsisText = synopsis && synopsis.length > 0
    ? synopsis
    : `A magical children's storybook adventure`;

  const childAge = child ? getChildAgeYears(child) : null;
  const childAgeText = childAge ? `${childAge} years old` : 'a young child';

  let prompt = `Create a book cover illustration for "${storyTitle}", with no text or words in the image.\n\n`;
  prompt += `Synopsis: ${synopsisText}\n\n`;

  if (child) {
    prompt += `The story is being created for $$${child.id}$$, age ${childAgeText}.\n\n`;
  }

  prompt += `The cover should feature the following characters:\n\n`;

  // Add main child as first actor
  if (child) {
    prompt += buildActorBlock(child, child.id) + '\n\n';
  }

  // Add all other actors (characters and siblings)
  for (const actor of allActors) {
    if (actor.id && actor.id !== child?.id) {
      prompt += buildActorBlock(actor, actor.id) + '\n\n';
    }
  }

  prompt += `Style: Whimsical, inviting children's book cover.`;

  return prompt.trim();
}

/**
 * Build image prompt for the back cover (uses ONLY the actors/avatars, no synopsis)
 * The back cover should show all characters celebrating together
 * New structured format with full actor details
 * Actors can be Characters (pets, friends, etc.) or ChildProfiles (siblings)
 */
function buildBackCoverImagePrompt(
  storyTitle: string,
  child?: ChildProfile | null,
  allActors: (Character | ChildProfile)[] = []
): string {
  const childAge = child ? getChildAgeYears(child) : null;
  const childAgeText = childAge ? `${childAge} years old` : 'a young child';

  let prompt = `Create an image for the back cover of a storybook, with no text or words in the image.\n\n`;
  prompt += `Show the characters celebrating together in a joyful scene.\n\n`;

  if (child) {
    prompt += `The story is being created for $$${child.id}$$, age ${childAgeText}.\n\n`;
  }

  prompt += `The scene contains the following characters:\n\n`;

  // Add main child as first actor
  if (child) {
    prompt += buildActorBlock(child, child.id) + '\n\n';
  }

  // Add all other actors (characters and siblings)
  for (const actor of allActors) {
    if (actor.id && actor.id !== child?.id) {
      prompt += buildActorBlock(actor, actor.id) + '\n\n';
    }
  }

  return prompt.trim();
}


function choosePlaceholderImage(index: number): string | undefined {
  if (!PlaceHolderImages || PlaceHolderImages.length === 0) return undefined;
  const image = PlaceHolderImages[index % PlaceHolderImages.length];
  return image?.imageUrl;
}

const StoryPageFlowOutput = z.object({
  ok: z.literal(true),
  bookId: z.string(),
  pages: z.array(FlowPageSchema),
  stats: z.object({
    totalPages: z.number(),
    interiorPages: z.number(),
  }),
  diagnostics: z.any(),
}).or(z.object({
  ok: z.literal(false),
  bookId: z.string(),
  errorMessage: z.string(),
  diagnostics: z.any(),
}));


export const storyPageFlow = ai.defineFlow(
  {
    name: 'storyPageFlow',
    inputSchema: z.object({
      storyId: z.string(),
      // Optional: pass storyOutputTypeId directly (e.g., from StoryBookOutput)
      // If not provided, falls back to session.storyOutputTypeId
      storyOutputTypeId: z.string().optional(),
    }),
    outputSchema: StoryPageFlowOutput,
  },
  async ({ storyId, storyOutputTypeId: inputStoryOutputTypeId }) => {
    let diagnostics: StoryPageFlowDiagnostics = { stage: 'init', details: { storyId } };

    try {
      const firestore = await getServerFirestore();
      diagnostics = { stage: 'loading', details: { storyId } };

      const storyRef = firestore.collection('stories').doc(storyId);
      const storySnap = await storyRef.get();
      if (!storySnap.exists) {
        throw new Error(`stories/${storyId} not found.`);
      }
      const story = storySnap.data() as Story;

      const [sessionSnap, childSnap] = await Promise.all([
        story.storySessionId ? firestore.collection('storySessions').doc(story.storySessionId).get() : Promise.resolve(null),
        story.childId ? firestore.collection('children').doc(story.childId).get() : Promise.resolve(null),
      ]);

      const session = (sessionSnap && sessionSnap.exists) ? (sessionSnap.data() as StorySession) : null;
      const child = (childSnap && childSnap.exists) ? { id: childSnap.id, ...childSnap.data() } as ChildProfile : null;

      // Load the story output type to get target page count
      // Priority: explicit input parameter > session.storyOutputTypeId
      const storyOutputTypeId = inputStoryOutputTypeId || session?.storyOutputTypeId;
      let storyOutputType: StoryOutputType | null = null;
      if (storyOutputTypeId) {
        const outputTypeSnap = await firestore.collection('storyOutputTypes').doc(storyOutputTypeId).get();
        if (outputTypeSnap.exists) {
          storyOutputType = outputTypeSnap.data() as StoryOutputType;
        }
      }

      // Get target content page count from output type (0 = unconstrained)
      const targetContentPages = storyOutputType?.layoutHints?.pageCount ?? 0;

      if (!story.storyText || story.storyText.trim().length === 0) {
        throw new Error(`stories/${storyId} is missing storyText.`);
      }

      const childName = child?.displayName ?? 'A Special Child';
      const derivedTitle = story.metadata?.title ?? session?.storyTitle ?? (childName ? `${childName}'s Adventure` : 'Storybook Adventure');

      // Get all actor IDs from the story (includes child and all characters)
      const allActorIds = story.actors ?? extractEntityIds(story.storyText);
      if (story.childId && !allActorIds.includes(story.childId)) {
        allActorIds.unshift(story.childId);
      }

      // Load all actors referenced in the story for image prompts
      // Actors can be in either the characters collection OR the children collection (siblings)
      // Note: Actor IDs might be document IDs OR display names (legacy data)
      const otherActorIds = allActorIds.filter(id => id !== story.childId);

      // Build a map of all actors (characters and siblings)
      const actorMap = new Map<string, Character | ChildProfile>();

      // First, try to load by document ID from both collections
      const [characterDocs, siblingDocs] = await Promise.all([
        otherActorIds.length > 0
          ? Promise.all(otherActorIds.map(id => firestore.collection('characters').doc(id).get()))
          : [],
        otherActorIds.length > 0
          ? Promise.all(otherActorIds.map(id => firestore.collection('children').doc(id).get()))
          : [],
      ]);

      // Add characters found by document ID
      characterDocs.forEach(doc => {
        if (doc.exists) {
          actorMap.set(doc.id, { id: doc.id, ...doc.data() } as Character);
        }
      });

      // Add siblings found by document ID (children who aren't the main child)
      siblingDocs.forEach(doc => {
        if (doc.exists && !actorMap.has(doc.id)) {
          actorMap.set(doc.id, { id: doc.id, ...doc.data() } as ChildProfile);
        }
      });

      // Fallback: For IDs not found by document ID, try to find by displayName
      // This handles legacy data where the AI used displayName instead of document ID
      const unfoundIds = otherActorIds.filter(id => !actorMap.has(id));
      if (unfoundIds.length > 0) {
        // Try finding characters by displayName (in chunks of 10 for Firestore)
        const chunkSize = 10;
        for (let i = 0; i < unfoundIds.length; i += chunkSize) {
          const chunk = unfoundIds.slice(i, i + chunkSize);
          const charsByName = await firestore
            .collection('characters')
            .where('displayName', 'in', chunk)
            .get();
          charsByName.forEach(doc => {
            const character = { id: doc.id, ...doc.data() } as Character;
            // Map by displayName (which was used as the placeholder)
            actorMap.set(character.displayName, character);
          });
        }

        // Try finding children by displayName
        const stillUnfound = unfoundIds.filter(id => !actorMap.has(id));
        for (let i = 0; i < stillUnfound.length; i += chunkSize) {
          const chunk = stillUnfound.slice(i, i + chunkSize);
          const childrenByName = await firestore
            .collection('children')
            .where('displayName', 'in', chunk)
            .get();
          childrenByName.forEach(doc => {
            const child = { id: doc.id, ...doc.data() } as ChildProfile;
            // Map by displayName (which was used as the placeholder)
            actorMap.set(child.displayName, child);
          });
        }
      }

      // Get all actors as an array for cover pages
      const allActors = Array.from(actorMap.values());

      // For backwards compatibility, also create allCharacters (characters only)
      const allCharacters = allActors.filter((a): a is Character => 'type' in a);

      // Resolve entity placeholders for display text
      const combinedTextForResolution = story.storyText;
      const entityMap = await resolveEntitiesInText(combinedTextForResolution);
      diagnostics.details.resolvedEntities = entityMap.size;

      diagnostics = {
        stage: 'chunking',
        details: {
          ...diagnostics.details,
          storyTextLength: story.storyText.length,
          hasChildProfile: !!child,
          hasSession: !!session,
          actorCount: allActorIds.length,
          characterCount: allCharacters.length,
          storyOutputTypeId: storyOutputTypeId ?? null,
          targetContentPages,
        },
      };

      // Use AI-driven pagination if we have a storyOutputTypeId
      // This replaces the old chunkSentences algorithm
      let chunks: string[][] = [];
      let aiPaginatedEntityIds: string[][] = [];
      let aiImageDescriptions: (string | undefined)[] = [];
      let usedAIPagination = false;

      if (storyOutputTypeId) {
        try {
          const paginationResult = await storyPaginationFlow({
            storyId,
            storyOutputTypeId,
          });

          if (paginationResult.ok && paginationResult.pages && paginationResult.pages.length > 0) {
            // Convert AI pagination result to chunks format
            chunks = paginationResult.pages.map((page: { bodyText: string }) => [page.bodyText]);
            aiPaginatedEntityIds = paginationResult.pages.map((page: { entityIds: string[] }) => page.entityIds || []);
            aiImageDescriptions = paginationResult.pages.map((page: { imageDescription?: string }) => page.imageDescription);
            usedAIPagination = true;
            diagnostics.details.usedAIPagination = true;
            diagnostics.details.aiPageCount = paginationResult.pages.length;
          } else {
            // Fall back to sentence-based chunking if AI pagination fails
            console.warn('[storyPageFlow] AI pagination failed, falling back to sentence chunking:', paginationResult.errorMessage);
            const sentences = splitSentences(story.storyText);
            chunks = chunkSentences(sentences, targetContentPages);
            diagnostics.details.usedAIPagination = false;
            diagnostics.details.paginationFallbackReason = paginationResult.errorMessage;
          }
        } catch (err: any) {
          // Fall back to sentence-based chunking on error
          console.warn('[storyPageFlow] AI pagination error, falling back to sentence chunking:', err.message);
          const sentences = splitSentences(story.storyText);
          chunks = chunkSentences(sentences, targetContentPages);
          diagnostics.details.usedAIPagination = false;
          diagnostics.details.paginationFallbackReason = err.message;
        }
      } else {
        // No storyOutputTypeId, use legacy chunking
        const sentences = splitSentences(story.storyText);
        chunks = chunkSentences(sentences, targetContentPages);
        diagnostics.details.usedAIPagination = false;
        diagnostics.details.paginationFallbackReason = 'No storyOutputTypeId';
      }

      diagnostics = {
        stage: 'building_pages',
        details: {
          ...diagnostics.details,
          chunks: chunks.length,
        },
      };

      const pages: FlowPage[] = [];
      let pageNumber = 0;

      // =================================================================
      // FRONT COVER (page 0)
      // - Text: Title / by / Child name (three lines, centered)
      // - Image: Derived from synopsis + full list of actors
      // =================================================================
      const frontCoverText = `${derivedTitle}\nby\n${childName}`;
      pages.push({
        pageNumber: pageNumber++,
        kind: 'cover_front',
        title: derivedTitle,
        bodyText: frontCoverText,
        displayText: frontCoverText,
        entityIds: allActorIds, // All actors for the cover image
        imagePrompt: buildFrontCoverImagePrompt(story.synopsis, derivedTitle, child, allActors),
        imageUrl: choosePlaceholderImage(0),
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      // =================================================================
      // TITLE PAGE (page 1)
      // - Text only (no image needed): "Title" / written by / "Child name" / on / "Friendly date"
      // =================================================================
      const friendlyDate = formatFriendlyDate(new Date());
      const titlePageText = `"${derivedTitle}"\n\nwritten by\n\n${childName}\n\non\n\n${friendlyDate}`;
      pages.push({
        pageNumber: pageNumber++,
        kind: 'title_page',
        title: derivedTitle,
        bodyText: titlePageText,
        displayText: titlePageText,
        entityIds: [], // No actors needed for title page
        // No imagePrompt or imageUrl - title page is text-only
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      // =================================================================
      // CONTENT PAGES (pages 2 to N-2)
      // - Each page has text and image derived from that page's text
      // - entityIds are the actors ($$id$$s) mentioned on that specific page
      // - If AI pagination was used, entityIds come from the AI; otherwise extracted from text
      // =================================================================
      for (const [index, chunk] of chunks.entries()) {
        const text = chunk.join(' ').trim();
        const displayText = await replacePlaceholders(text, entityMap);
        // Use AI-provided entityIds if available, otherwise extract from text
        const pageEntityIds = usedAIPagination && aiPaginatedEntityIds[index]
          ? aiPaginatedEntityIds[index]
          : extractEntityIds(text);
        // Use AI-provided imageDescription if available
        const pageImageDescription = usedAIPagination ? aiImageDescriptions[index] : undefined;
        // Get all actors that appear on this specific page (characters and siblings)
        // Look up by the entity ID which might be a document ID or displayName
        const actorsOnPage = pageEntityIds
          .map(id => actorMap.get(id))
          .filter((a): a is Character | ChildProfile => !!a);
        pages.push({
          pageNumber: pageNumber++,
          kind: 'text',
          bodyText: text,
          displayText: displayText,
          entityIds: pageEntityIds,
          imageDescription: pageImageDescription,
          imagePrompt: buildImagePrompt(displayText, child, derivedTitle, actorsOnPage, pageEntityIds, pageImageDescription),
          imageUrl: choosePlaceholderImage(index + 2), // +2 to account for cover and title page
          layoutHints: {
            aspectRatio: 'landscape',
            textPlacement: index % 2 === 0 ? 'bottom' : 'top',
          },
        });
      }

      // =================================================================
      // BLANK PAGE (last interior page before back cover)
      // - Must be completely blank (no text, no image)
      // - Used for print alignment, skipped by story reader
      // =================================================================
      pages.push({
        pageNumber: pageNumber++,
        kind: 'blank',
        bodyText: '',
        displayText: '',
        entityIds: [],
        // No imagePrompt or imageUrl - blank pages have no content
        layoutHints: { aspectRatio: 'landscape', textPlacement: 'bottom' },
      });

      // Calculate additional blank pages needed to make total a multiple of 4
      // Current count: front cover + title page + content pages + 1 blank, back cover will be added
      const currentCountBeforeBackCover = pages.length;
      const totalWithBackCover = currentCountBeforeBackCover + 1;
      const remainder = totalWithBackCover % 4;
      const additionalBlanksNeeded = remainder === 0 ? 0 : 4 - remainder;

      // Add additional blank/decorative pages if needed for print alignment
      for (let i = 0; i < additionalBlanksNeeded; i++) {
        pages.push({
          pageNumber: pageNumber++,
          kind: 'blank',
          bodyText: '',
          displayText: '',
          entityIds: [],
          // No imagePrompt or imageUrl - blank pages have no content
          layoutHints: { aspectRatio: 'landscape', textPlacement: 'bottom' },
        });
      }

      // =================================================================
      // BACK COVER (last page)
      // - Image derived ONLY from the list of actors (their avatars)
      // - No synopsis used for back cover
      // =================================================================
      pages.push({
        pageNumber: pageNumber++,
        kind: 'cover_back',
        bodyText: '',
        displayText: '',
        entityIds: allActorIds, // All actors for the back cover image
        imagePrompt: buildBackCoverImagePrompt(derivedTitle, child, allActors),
        imageUrl: choosePlaceholderImage(pages.length),
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      diagnostics = {
        stage: 'done',
        details: {
          ...diagnostics.details,
          totalPages: pages.length,
          interiorPages: Math.max(0, pages.length - 2), // Excludes front/back covers
          blankPagesAdded: 1 + additionalBlanksNeeded, // 1 required blank + alignment blanks
          hasTitlePage: true,
        },
      };

      const sessionIdForEvent = sessionSnap?.id ?? story.storySessionId ?? null;
      if (sessionIdForEvent) {
        await logSessionEvent({
          firestore,
          sessionId: sessionIdForEvent,
          event: 'pages.generated',
          status: 'completed',
          source: 'server',
          attributes: {
            storyId,
            pageCount: pages.length,
          },
        });
      }

      return {
        ok: true as const,
        bookId: storyId, // The input is storyId which is the bookId now
        pages,
        stats: {
          totalPages: chunks.length,
          interiorPages: Math.max(0, pages.length - 2),
        },
        diagnostics,
      };
    } catch (error: any) {
      diagnostics = {
        stage: 'error',
        details: {
          message: error?.message ?? String(error),
        },
      };
      return {
        ok: false as const,
        bookId: storyId,
        errorMessage: error?.message ?? 'Unexpected storyPageFlow error.',
        diagnostics,
      };
    }
  }
);
