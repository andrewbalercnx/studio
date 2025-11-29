
'use server';

import {ai} from '@/ai/genkit';
import {initializeFirebase} from '@/firebase';
import {getStoryBucket, deleteStorageObject} from '@/firebase/admin/storage';
import type {ChildProfile, StoryBook, StoryBookPage} from '@/lib/types';
import {randomUUID} from 'crypto';
import {doc, getDoc, serverTimestamp, updateDoc} from 'firebase/firestore';
import {z} from 'genkit';
import imageSize from 'image-size';
import { Gaxios, GaxiosError } from 'gaxios';

const DEFAULT_IMAGE_MODEL = process.env.STORYBOOK_IMAGE_MODEL ?? 'googleai/gemini-2.5-flash-image-preview';
const MOCK_IMAGES = process.env.MOCK_STORYBOOK_IMAGES === 'true';

type GenerateImageResult = {
  buffer: Buffer;
  mimeType: string;
  modelUsed: string;
};

const StoryImageFlowInput = z.object({
  bookId: z.string(),
  pageId: z.string(),
  regressionTag: z.string().optional(),
  forceRegenerate: z.boolean().optional(),
});

const StoryImageFlowOutput = z.object({
  ok: z.literal(true),
  bookId: z.string(),
  pageId: z.string(),
  imageUrl: z.string(),
  imageStatus: z.literal('ready'),
  logs: z.array(z.string()).optional(),
}).or(
  z.object({
    ok: z.literal(false),
    bookId: z.string(),
    pageId: z.string(),
    imageStatus: z.literal('error'),
    errorMessage: z.string(),
    logs: z.array(z.string()).optional(),
  })
);

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const gaxios = new Gaxios();
    const response = await gaxios.request<ArrayBuffer>({
      url,
      responseType: 'arraybuffer',
    });

    if (response.status !== 200 || !response.data) {
      console.warn(`[story-image-flow] Failed to fetch image ${url}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[story-image-flow] Gaxios error fetching ${url}: ${error.message}`);
    } else {
      console.error(`[story-image-flow] Unexpected error fetching ${url}:`, error);
    }
    return null;
  }
}

function mapAspectRatio(layout?: StoryBookPage['layoutHints']): string | undefined {
  if (!layout?.aspectRatio) return undefined;
  switch (layout.aspectRatio) {
    case 'portrait':
      return '3:4';
    case 'landscape':
      return '4:3';
    case 'square':
      return '1:1';
    default:
      return undefined;
  }
}

function buildMockSvg(prompt: string): GenerateImageResult {
  const width = 1024;
  const height = 1024;
  const truncatedPrompt = prompt.length > 160 ? `${prompt.slice(0, 157)}…` : prompt;
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#d4e4ff" />
        <stop offset="100%" stop-color="#f9d5ff" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)" />
    <text x="50%" y="50%" font-size="36" font-family="sans-serif" text-anchor="middle" fill="#1f2d3d">
      Storybook Mock
    </text>
    <foreignObject x="80" y="560" width="${width - 160}" height="${height - 640}">
      <div xmlns="http://www.w3.org/1999/xhtml"
        style="font-size:24px;font-family:serif;line-height:1.4;color:#1f2d3d;text-align:center;">
        ${truncatedPrompt.replace(/&/g, '&amp;')}
      </div>
    </foreignObject>
  </svg>
  `.trim();
  return {
    buffer: Buffer.from(svg),
    mimeType: 'image/svg+xml',
    modelUsed: 'mock/storybook',
  };
}

function parseDataUrl(dataUrl: string): {mimeType: string; buffer: Buffer} {
  const match = /^data:(.+);base64,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Model returned an invalid media payload.');
  }
  const mimeType = match[1];
  const base64 = match[2];
  return {
    mimeType,
    buffer: Buffer.from(base64, 'base64'),
  };
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'img';
}

function buildStoragePath(bookId: string, pageId: string, mimeType: string): string {
  return `storyBooks/${bookId}/pages/${pageId}.${extensionFromMime(mimeType)}`;
}

async function uploadImageToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  bookId: string;
  pageId: string;
  regressionTag?: string;
}) {
  let bucket;
  try {
    bucket = await getStoryBucket();
  } catch (err: any) {
    const message = err?.message || String(err);
    throw new Error(`BUCKET_UNAVAILABLE:${message}`);
  }
  const objectPath = buildStoragePath(params.bookId, params.pageId, params.mimeType);
  const downloadToken = randomUUID();
  const metadata: Record<string, string> = {
    bookId: params.bookId,
    pageId: params.pageId,
  };
  if (params.regressionTag) {
    metadata.regressionTag = params.regressionTag;
    metadata.regressionTest = 'true';
  }

  await bucket
    .file(objectPath)
    .save(params.buffer, {
      contentType: params.mimeType,
      resumable: false,
      metadata: {
        metadata: {
          ...metadata,
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
      cacheControl: 'public,max-age=3600',
    });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    objectPath
  )}?alt=media&token=${downloadToken}`;

  return {imageUrl, objectPath, downloadToken};
}

async function createImage(prompt: string, childPhotos: string[], artStyle: string): Promise<GenerateImageResult> {
  if (MOCK_IMAGES) {
    return buildMockSvg(prompt);
  }
  
  const imageParts = (await Promise.all(
    childPhotos.map(async (url) => {
      const dataUri = await fetchImageAsDataUri(url);
      return dataUri ? { media: { url: dataUri } } : null;
    })
  )).filter((part): part is { media: { url: string } } => part !== null);

  const promptParts: any[] = [
    ...imageParts,
    { text: `Art style: ${artStyle}. Scene: ${prompt}` },
  ];

  const generation = await ai.generate({
    model: DEFAULT_IMAGE_MODEL,
    prompt: promptParts,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  const media = generation.media;
  if (!media?.url) {
    throw new Error('Image model returned no media payload.');
  }

  const {mimeType, buffer} = parseDataUrl(media.url);
  return {
    buffer,
    mimeType,
    modelUsed: generation.model ?? DEFAULT_IMAGE_MODEL,
  };
}

export const storyImageFlow = ai.defineFlow(
  {
    name: 'storyImageFlow',
    inputSchema: StoryImageFlowInput,
    outputSchema: StoryImageFlowOutput,
  },
  async ({bookId, pageId, regressionTag, forceRegenerate}) => {
    const logs: string[] = [];
    const {firestore} = initializeFirebase();
    const pageRef = doc(firestore, 'storyBooks', bookId, 'pages', pageId);
    let generated: GenerateImageResult | null = null;
    try {
      const bookSnap = await getDoc(doc(firestore, 'storyBooks', bookId));
      if (!bookSnap.exists()) {
        throw new Error(`storyBooks/${bookId} not found.`);
      }
      const bookData = bookSnap.data() as StoryBook;

      let childProfile: ChildProfile | null = null;
      if (bookData.childId) {
        const childSnap = await getDoc(doc(firestore, 'children', bookData.childId));
        if (childSnap.exists()) {
          childProfile = childSnap.data() as ChildProfile;
        }
      }

      const pageSnap = await getDoc(pageRef);
      if (!pageSnap.exists()) {
        throw new Error(`storyBooks/${bookId}/pages/${pageId} not found.`);
      }
      const page = pageSnap.data() as StoryBookPage;
      if (!page.imagePrompt) {
        throw new Error(`Page ${pageId} is missing imagePrompt.`);
      }

      if (forceRegenerate && page.imageMetadata?.storagePath) {
        try {
          await deleteStorageObject(page.imageMetadata.storagePath);
          logs.push(`[cleanup] Deleted ${page.imageMetadata.storagePath}`);
        } catch (error: any) {
          logs.push(`[cleanup] Failed to delete ${page.imageMetadata.storagePath}: ${error?.message ?? error}`);
        }
      }

      await updateDoc(pageRef, {
        imageStatus: 'generating',
        'imageMetadata.lastErrorMessage': null,
        updatedAt: serverTimestamp(),
      });

      try {
        const childPhotos = childProfile?.photos?.slice(0, 3) ?? [];
        const artStyle = bookData.metadata?.artStyleHint ?? "a gentle, vibrant watercolor style";
        generated = await createImage(page.imagePrompt, childPhotos, artStyle);
      } catch (generationError: any) {
        const fallbackAllowed = MOCK_IMAGES || !!regressionTag || process.env.STORYBOOK_IMAGE_FALLBACK === 'true';
        const errMessage = generationError?.message ?? String(generationError);
        logs.push(`[warn] Image model failed for ${pageId}: ${errMessage}`);
        if (!fallbackAllowed) {
          throw generationError;
        }
        logs.push(`[info] Using mock artwork fallback for ${pageId}.`);
        generated = buildMockSvg(page.imagePrompt);
      }

      if (!generated) {
        throw new Error('Image generation failed and no fallback was created.');
      }
      
      let uploadResult:
        | {imageUrl: string; objectPath: string | null; downloadToken: string | null}
        | null = null;
      try {
        uploadResult = await uploadImageToStorage({
          buffer: generated.buffer,
          mimeType: generated.mimeType,
          bookId,
          pageId,
          regressionTag,
        });
      } catch (uploadError: any) {
        const uploadMessage = uploadError?.message ?? String(uploadError);
        logs.push(`[warn] Upload failed for ${pageId}: ${uploadMessage}`);
        if (uploadMessage.startsWith('BUCKET_UNAVAILABLE')) {
          const inlineDataUrl = `data:${generated.mimeType};base64,${generated.buffer.toString('base64')}`;
          uploadResult = {
            imageUrl: inlineDataUrl,
            objectPath: null,
            downloadToken: null,
          };
          logs.push(`[info] Using inline data URL fallback for ${pageId}.`);
        } else {
          throw uploadError;
        }
      }
      let width: number | null = null;
      let height: number | null = null;
      try {
        const dimensions = imageSize(generated.buffer);
        width = dimensions?.width ?? null;
        height = dimensions?.height ?? null;
      } catch (dimensionError: any) {
        logs.push(`[warn] Unable to parse image dimensions: ${dimensionError?.message ?? dimensionError}`);
      }

      await updateDoc(pageRef, {
        imageUrl: uploadResult.imageUrl,
        imageStatus: 'ready',
        imageMetadata: {
          model: generated.modelUsed,
          width,
          height,
          mimeType: generated.mimeType,
          sizeBytes: generated.buffer.byteLength,
          storagePath: uploadResult.objectPath,
          downloadToken: uploadResult.downloadToken,
          aspectRatioHint: page.layoutHints?.aspectRatio ?? null,
          regressionTag: regressionTag ?? page.regressionTag ?? null,
          generatedAt: serverTimestamp(),
          lastErrorMessage: null,
        },
        updatedAt: serverTimestamp(),
      });

      logs.push(`[success] Generated art for ${pageId}`);
      return {
        ok: true as const,
        bookId,
        pageId,
        imageUrl: uploadResult.imageUrl,
        imageStatus: 'ready' as const,
        logs,
      };
    } catch (error: any) {
      const message = error?.message ?? 'storyImageFlow failed.';
      try {
        await updateDoc(pageRef, {
          imageStatus: 'error',
          'imageMetadata.lastErrorMessage': message,
          updatedAt: serverTimestamp(),
        });
      } catch (updateError) {
        logs.push(`[warn] Failed to record error state: ${(updateError as Error)?.message}`);
      }
      logs.push(`[error] ${message}`);
      const fallbackImageUrl = generated ? `data:${generated.mimeType};base64,${generated.buffer.toString('base64')}` : 'error.png';
      return {
        ok: false as const,
        bookId,
        pageId,
        imageStatus: 'error' as const,
        errorMessage: message,
        logs,
      };
    }
  }
);
