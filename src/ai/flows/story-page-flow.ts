'use server';

import { ai } from '@/ai/genkit';
import { initializeFirebase } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { z } from 'genkit';
import type { StoryBook, StorySession, ChildProfile } from '@/lib/types';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { logSessionEvent } from '@/lib/session-events';

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
  imagePrompt: z.string().optional(),
  imageUrl: z.string().optional(),
  layoutHints: PageLayoutSchema.optional(),
});

const StoryPageFlowOutput = z.object({
  ok: z.boolean(),
  bookId: z.string(),
  pages: z.array(FlowPageSchema).optional(),
  stats: z
    .object({
      totalSentences: z.number().int().nonnegative().optional(),
      interiorPages: z.number().int().nonnegative().optional(),
    })
    .optional(),
  errorMessage: z.string().optional(),
  diagnostics: z.any().optional(),
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

function chunkSentences(sentences: string[]): string[][] {
  if (sentences.length === 0) return [];
  const chunks: string[][] = [];
  let current: string[] = [];
  sentences.forEach((sentence) => {
    current.push(sentence);
    if (current.length === 2) {
      chunks.push(current);
      current = [];
    }
  });
  if (current.length > 0) {
    chunks.push(current);
  }

  // Clamp to <=16 interior chunks by merging from the end.
  while (chunks.length > 16) {
    const merged: string[][] = [];
    for (let i = 0; i < chunks.length; i += 2) {
      if (i + 1 < chunks.length) {
        merged.push([...chunks[i], ...chunks[i + 1]]);
      } else {
        merged.push(chunks[i]);
      }
    }
    chunks.splice(0, chunks.length, ...merged);
  }

  return chunks;
}

function buildImagePrompt(text: string, child?: ChildProfile | null, storyTitle?: string | null) {
  const summary = text.length > 160 ? `${text.slice(0, 157)}…` : text;
  const childName = child?.displayName;
  const nameFragment = childName ? `featuring ${childName}` : 'featuring the main character';
  const titleFragment = storyTitle ? `from "${storyTitle}"` : 'from the bedtime story';
  const colorHint = child?.preferences?.favoriteColors?.length
    ? `Palette inspired by ${child.preferences.favoriteColors.slice(0, 2).join(' and ')}`
    : '';
  const gameHint = child?.preferences?.favoriteGames?.length
    ? `, playful energy of ${child.preferences.favoriteGames[0]}`
    : '';
  const subjectHint = child?.preferences?.favoriteSubjects?.length
    ? `. Mood should feel like a ${child.preferences.favoriteSubjects[0]} activity`
    : '';
  return `${summary} ${nameFragment} ${titleFragment} in watercolor style. ${colorHint}${gameHint}${subjectHint}`.trim();
}

function choosePlaceholderImage(index: number): string | undefined {
  if (!PlaceHolderImages || PlaceHolderImages.length === 0) return undefined;
  const image = PlaceHolderImages[index % PlaceHolderImages.length];
  return image?.imageUrl;
}

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

      diagnostics = {
        stage: 'chunking',
        details: {
          sentences: book.storyText.length,
          hasChildProfile: !!child,
          hasSession: !!session,
        },
      };

      const sentences = splitSentences(book.storyText);
      const chunks = chunkSentences(sentences);

      diagnostics = {
        stage: 'building_pages',
        details: {
          sentences: sentences.length,
          chunks: chunks.length,
        },
      };

      const pages: FlowPage[] = [];
      const childName = child?.displayName;
      const derivedTitle = session?.storyTitle ?? (childName ? `${childName}'s Adventure` : 'Storybook Adventure');

      let pageNumber = 0;
      pages.push({
        pageNumber: pageNumber++,
        kind: 'cover_front',
        title: derivedTitle,
        bodyText: childName ? `A story just for ${childName}` : 'A story made with love.',
        imagePrompt: buildImagePrompt(`Front cover artwork for "${derivedTitle}"`, child, derivedTitle),
        imageUrl: choosePlaceholderImage(0),
        imageStatus: 'pending',
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      chunks.forEach((chunk, index) => {
        const text = chunk.join(' ').trim();
        pages.push({
          pageNumber: pageNumber++,
          kind: 'text',
          bodyText: text,
          imagePrompt: buildImagePrompt(text, child, derivedTitle),
          imageUrl: choosePlaceholderImage(index + 1),
          imageStatus: 'pending',
          layoutHints: {
            aspectRatio: 'landscape',
            textPlacement: index % 2 === 0 ? 'bottom' : 'top',
          },
        });
      });

      pages.push({
        pageNumber: pageNumber++,
        kind: 'cover_back',
        bodyText: childName
          ? `Thanks for reading with ${childName}!`
          : 'The adventure continues next time.',
        imagePrompt: buildImagePrompt(`Back cover illustration for "${derivedTitle}" showing a gentle closing scene`, child, derivedTitle),
        imageUrl: choosePlaceholderImage(pages.length),
        imageStatus: 'pending',
        layoutHints: { aspectRatio: 'portrait', textPlacement: 'bottom' },
      });

      diagnostics = {
        stage: 'done',
        details: {
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
