/**
 * Style: how a Book looks (domain-model.md "Configuration").
 *
 * Target collection `styles/{styleId}`; read for now from today's curated
 * `imageStyles` documents:
 *
 *   imageStyles.title                    → Style.name
 *   imageStyles.stylePrompt              → Style.prompt
 *   imageStyles.exampleImages[].url      → Style.exampleImages
 *   imageStyles.sampleImageUrl           → Style.sampleImageUrl
 *   imageStyles.sceneExemplars[tag]      → Style.sceneReferences[tag] (only entries with status `ready`)
 */
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

export type Style = {
  styleId: string;
  name: string;
  /** The art-style prompt every image in a Book of this Style uses. */
  prompt: string;
  exampleImages: string[];
  sampleImageUrl: string | null;
  /** Scene reference images by scene tag (`indoor-day`, …). */
  sceneReferences: Record<string, string>;
};

const styleDocSchema = z
  .object({
    title: z.string().optional(),
    stylePrompt: z.string().optional(),
    exampleImages: z.array(z.object({ url: z.string().optional() }).passthrough()).optional(),
    sampleImageUrl: z.string().nullable().optional(),
    sceneExemplars: z
      .record(z.object({ imageUrl: z.string().nullable().optional(), status: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export function styleFromDocument(styleId: string, raw: unknown): Style | null {
  const parsed = styleDocSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    console.error(`[catalog] Style ${styleId} is malformed`, parsed.error.issues);
    return null;
  }
  const doc = parsed.data;
  const prompt = doc.stylePrompt?.trim();
  if (!prompt) return null;
  const sceneReferences: Record<string, string> = {};
  for (const [tag, entry] of Object.entries(doc.sceneExemplars ?? {})) {
    if (entry.status === 'ready' && entry.imageUrl) sceneReferences[tag] = entry.imageUrl;
  }
  return {
    styleId,
    name: doc.title ?? styleId,
    prompt,
    exampleImages: (doc.exampleImages ?? []).map((image) => image.url).filter((url): url is string => !!url),
    sampleImageUrl: doc.sampleImageUrl || null,
    sceneReferences,
  };
}

/** Today's collection holding Styles. */
export const STYLES_COLLECTION = 'imageStyles';

export async function loadStyle(db: Firestore, styleId: string): Promise<Style | null> {
  if (!styleId) return null;
  const snapshot = await db.collection(STYLES_COLLECTION).doc(styleId).get();
  return snapshot.exists ? styleFromDocument(snapshot.id, snapshot.data()) : null;
}

/**
 * Style reference images for one picture, in today's priority order
 * (story-image-flow): the scene reference for the page's tag, else the
 * uploaded example images, else the generated sample.
 */
export function styleReferencesFor(style: Style, sceneTag?: string | null): string[] {
  if (sceneTag && style.sceneReferences[sceneTag]) return [style.sceneReferences[sceneTag]];
  if (style.exampleImages.length > 0) return style.exampleImages;
  return style.sampleImageUrl ? [style.sampleImageUrl] : [];
}

/** Reference images for a cast sheet (story-exemplar-generation-flow): examples, else the sample. */
export function styleExamplesFor(style: Style): string[] {
  if (style.exampleImages.length > 0) return style.exampleImages;
  return style.sampleImageUrl ? [style.sampleImageUrl] : [];
}
