

'use server';

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { z } from 'genkit';
import type { StoryBook, StorySession, ChildProfile, Character, StoryBookPage as StoryBookPageType } from '@/lib/types';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { logSessionEvent } from '@/lib/session-events';
import { resolveEntities, replacePlaceholders, getEntitiesInText } from '@/lib/resolve-placeholders';


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
  kind: z.enum(['cover_front', 'cover_back', 'text', 'image']),
  title: z.string().optional(),
  bodyText: z.string().optional(),
  displayText: z.string().optional(),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  layoutHints: PageLayoutSchema.optional(),
});

type FlowPage = z.infer<typeof FlowPageSchema>;

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

function chunkSentences(sentences: string[], maxChunks = 16): string[][] {
  if (sentences.length === 0) return [];
  
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

function buildImagePrompt(
  text: string, 
  child?: ChildProfile | null, 
  storyTitle?: string | null, 
  charactersInPage: Character[] = []
): string {
    const summary = text.length > 160 ? `${text.slice(0, 157)}…` : text;
    const titleFragment = storyTitle ? `from "${storyTitle}"` : 'from the bedtime story';

    const characterDetails = charactersInPage.map(c => {
        const traits = c.traits ? ` who is ${c.traits.join(', ')}` : '';
        const visualNotes = c.visualNotes ? Object.values(c.visualNotes).filter(Boolean).join(', ') : '';
        return `${c.displayName} (${c.role}${traits})${visualNotes ? `, wearing ${visualNotes}` : ''}`;
    }).join('; ');

    const characterFragment = characterDetails ? `featuring ${characterDetails}` : (child?.displayName ? `featuring ${child.displayName}` : 'featuring the main character');

    const colorHint = child?.preferences?.favoriteColors?.length
        ? `Palette inspired by ${child.preferences.favoriteColors.slice(0, 2).join(' and ')}`
        : '';
    const gameHint = child?.preferences?.favoriteGames?.length
        ? `, playful energy of ${child.preferences.favoriteGames[0]}`
        : '';
    const subjectHint = child?.preferences?.favoriteSubjects?.length
        ? `. Mood should feel like a ${child.preferences.favoriteSubjects[0]} activity`
        : '';
    
    return `${summary} ${characterFragment} ${titleFragment} in a gentle, vibrant watercolor style. ${colorHint}${gameHint}${subjectHint}`.trim().replace(/\s+/g, ' ');
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
    totalSentences: z.number(),
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
    inputSchema: z.object({ bookId: z.string() }),
    outputSchema: StoryPageFlowOutput,
  },
  async ({ bookId }) => {
    let diagnostics: StoryPageFlowDiagnostics = { stage: 'init', details: { bookId } };

    try {
      const { firestore } = initializeFirebase();
      diagnostics = { stage: 'loading', details: { bookId } };

      const bookRef = doc(firestore, 'storyBooks', bookId);
      const bookSnap = await getDoc(bookRef);
      if (!bookSnap.exists()) {
        throw new Error(`storyBooks/${bookId} not found.`);
      }
      const book = bookSnap.data() as StoryBook;

      const [sessionSnap, childSnap] = await Promise.all([
        book.storySessionId ? getDoc(doc(firestore, 'storySessions', book.storySessionId)) : Promise.resolve(null),
        book.childId ? getDoc(doc(firestore, 'children', book.childId)) : Promise.resolve(null),
      ]);

      const session = sessionSnap?.exists() ? (sessionSnap.data() as StorySession) : null;
      const child = childSnap?.exists() ? (childSnap.data() as ChildProfile) : null;

      if (!book.storyText || book.storyText.trim().length === 0) {
        throw new Error(`storyBooks/${bookId} is missing storyText.`);
      }
      
      const entityMap = await resolveEntities(book.storyText);
      diagnostics.details.resolvedEntities = entityMap.size;

      diagnostics = {
        stage: 'chunking',
        details: {
          ...diagnostics.details,
          storyTextLength: book.storyText.length,
          hasChildProfile: !!child,
          hasSession: !!session,
        },
      };

      const sentences = splitSentences(book.storyText);
      const chunks = chunkSentences(sentences);

      diagnostics = {
        stage: 'building_pages',
        details: {
          ...diagnostics.details,
          sentences: sentences.length,
          chunks: chunks.length,
        },
      };

      const pages: FlowPage[] = [];
      const childName = child?.displayName;
      const derivedTitle = session?.storyTitle ?? (childName ? `${childName}'s Adventure` : 'Storybook Adventure');

      let pageNumber = 0;
      
      const coverText = childName ? `A story just for $$${child?.id}$$` : 'A story made with love.';
      const coverDisplayText = replacePlaceholders(coverText, entityMap);
      const coverEntities = getEntitiesInText(coverText, entityMap);
      pages.push({
        pageNumber: pageNumber++,
        kind: 'cover_front',
        title: derivedTitle,
        bodyText: coverText,
        displayText: coverDisplayText,
        imagePrompt: buildImagePrompt(coverDisplayText, child, derivedTitle, coverEntities),
        imageUrl: choosePlaceholderImage(0),
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      chunks.forEach((chunk, index) => {
        const text = chunk.join(' ').trim();
        const displayText = replacePlaceholders(text, entityMap);
        const entitiesOnPage = getEntitiesInText(text, entityMap);
        pages.push({
          pageNumber: pageNumber++,
          kind: 'text',
          bodyText: text,
          displayText: displayText,
          imagePrompt: buildImagePrompt(displayText, child, derivedTitle, entitiesOnPage),
          imageUrl: choosePlaceholderImage(index + 1),
          layoutHints: {
            aspectRatio: 'landscape',
            textPlacement: index % 2 === 0 ? 'bottom' : 'top',
          },
        });
      });
      
      const backCoverText = childName ? `Thanks for reading with $$${child?.id}$$!` : 'The adventure continues next time.';
      const backCoverDisplayText = replacePlaceholders(backCoverText, entityMap);
      const backCoverEntities = getEntitiesInText(backCoverText, entityMap);
      pages.push({
        pageNumber: pageNumber++,
        kind: 'cover_back',
        bodyText: backCoverText,
        displayText: backCoverDisplayText,
        imagePrompt: buildImagePrompt(backCoverDisplayText, child, derivedTitle, backCoverEntities),
        imageUrl: choosePlaceholderImage(pages.length),
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      diagnostics = {
        stage: 'done',
        details: {
          ...diagnostics.details,
          totalPages: pages.length,
          interiorPages: Math.max(0, pages.length - 2),
        },
      };

      const sessionIdForEvent = sessionSnap?.id ?? book.storySessionId ?? null;
      if (sessionIdForEvent) {
        await logSessionEvent({
          firestore,
          sessionId: sessionIdForEvent,
          event: 'pages.generated',
          status: 'completed',
          source: 'server',
          attributes: {
            bookId,
            pageCount: pages.length,
          },
        });
      }

      return {
        ok: true,
        bookId,
        pages,
        stats: {
          totalSentences: sentences.length,
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
        ok: false,
        bookId,
        errorMessage: error?.message ?? 'Unexpected storyPageFlow error.',
        diagnostics,
      };
    }
  }
);

    
