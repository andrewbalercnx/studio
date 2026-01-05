
'use server';

import {ai} from '@/ai/genkit';
import {initFirebaseAdminApp} from '@/firebase/admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {getStoryBucket, deleteStorageObject} from '@/firebase/admin/storage';
import type {ChildProfile, Story, StoryOutputPage, Character, ImageStyle} from '@/lib/types';
import {randomUUID} from 'crypto';
import {z} from 'genkit';
import imageSize from 'image-size';
import { Gaxios, GaxiosError } from 'gaxios';
import { logAIFlow } from '@/lib/ai-flow-logger';
import { notifyMaintenanceError } from '@/lib/email/notify-admins';
import { getGlobalImagePrompt } from '@/lib/image-prompt-config.server';
// New actor utilities - available for future use alongside existing fetchEntityReferenceData
import {
  getActorsDetailsWithImageData,
  type ActorDetailsWithImageData,
} from '@/lib/story-context-builder';

/**
 * Validate that a value is a valid Firestore document ID.
 * Returns true if the value is a non-empty string.
 */
function isValidDocumentId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

const DEFAULT_IMAGE_MODEL = process.env.STORYBOOK_IMAGE_MODEL ?? 'googleai/gemini-2.5-flash-image-preview';
const MOCK_IMAGES = process.env.MOCK_STORYBOOK_IMAGES === 'true';

type GenerateImageResult = {
  buffer: Buffer;
  mimeType: string;
  modelUsed: string;
};

const StoryImageFlowInput = z.object({
  storyId: z.string(),
  pageId: z.string(),
  regressionTag: z.string().optional(),
  forceRegenerate: z.boolean().optional(),
  // New fields for StoryBookOutput model
  storybookId: z.string().optional(),        // If set, uses stories/{storyId}/storybooks/{storybookId}/pages path
  // Use z.any() to bypass genkit's JSON schema validation bug with null values
  // The flow logic handles null by treating it as undefined (falsy check)
  targetWidthPx: z.any().optional(),
  targetHeightPx: z.any().optional(),
  imageStylePrompt: z.string().optional(),   // Art style prompt (from StoryBookOutput)
  imageStyleId: z.string().optional(),       // ID to load example images from imageStyles collection
  // Aspect ratio for the generated image (e.g., "3:4", "4:3", "1:1", "4:5")
  // Gemini 2.5 Flash Image supports: 21:9, 16:9, 4:3, 3:2, 1:1, 9:16, 3:4, 2:3, 5:4, 4:5
  aspectRatio: z.string().optional(),
});

const StoryImageFlowOutput = z.object({
  ok: z.literal(true),
  storyId: z.string(),
  pageId: z.string(),
  imageUrl: z.string(),
  imageStatus: z.literal('ready'),
  logs: z.array(z.string()).optional(),
}).or(
  z.object({
    ok: z.literal(false),
    storyId: z.string(),
    pageId: z.string(),
    imageStatus: z.literal('error'),
    errorMessage: z.string(),
    logs: z.array(z.string()).optional(),
  })
);

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const gaxios = new Gaxios();
    // Use URL to correctly handle query parameters
    const urlObject = new URL(url);
    if (process.env.GEMINI_API_KEY) {
      urlObject.searchParams.append('key', process.env.GEMINI_API_KEY);
    }
    const finalUrl = urlObject.toString();
    
    const response = await gaxios.request<ArrayBuffer>({
      url: finalUrl,
      responseType: 'arraybuffer',
    });

    if (response.status !== 200 || !response.data) {
      console.warn(`[story-image-flow] Failed to fetch image ${finalUrl}, status: ${response.status}`);
      return null;
    }

    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof GaxiosError) {
      console.error(`[story-image-flow] Gaxios error fetching ${url}: ${error.message}`);
    } else if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      console.error(`[story-image-flow] Invalid URL provided: ${url}`);
    } else {
      console.error(`[story-image-flow] Unexpected error fetching ${url}:`, error);
    }
    return null;
  }
}

function mapAspectRatio(layout?: StoryOutputPage['layoutHints']): string | undefined {
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

function buildMockSvg(prompt: string, targetWidthPx?: number, targetHeightPx?: number): GenerateImageResult {
  const width = targetWidthPx || 1024;
  const height = targetHeightPx || 1024;
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

async function parseMediaUrl(mediaUrl: string): Promise<{mimeType: string; buffer: Buffer}> {
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new Error(
      `Model returned invalid media payload: expected string, got ${typeof mediaUrl}. ` +
      `Value: ${JSON.stringify(mediaUrl)?.substring(0, 100)}`
    );
  }

  // Try parsing as a data URL first (standard format: data:image/png;base64,...)
  const match = /^data:(.+);base64,(.*)$/i.exec(mediaUrl);
  if (match) {
    const mimeType = match[1];
    const base64 = match[2];

    if (!base64 || base64.length === 0) {
      throw new Error(
        `Model returned data URL with empty base64 content. ` +
        `MIME type: ${mimeType}. URL prefix: ${mediaUrl.substring(0, 50)}`
      );
    }

    return {
      mimeType,
      buffer: Buffer.from(base64, 'base64'),
    };
  }

  // Check if it's a regular URL (https:// or http://)
  if (mediaUrl.startsWith('https://') || mediaUrl.startsWith('http://')) {
    console.log('[story-image-flow] Model returned regular URL, fetching image:', mediaUrl.substring(0, 100));
    try {
      const gaxios = new Gaxios();
      const response = await gaxios.request({
        url: mediaUrl,
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const buffer = Buffer.from(response.data as ArrayBuffer);
      const contentType = response.headers?.['content-type'] as string || 'image/png';
      // Extract just the mime type without charset or other parameters
      const mimeType = contentType.split(';')[0].trim();

      console.log('[story-image-flow] Fetched image from URL:', {
        size: buffer.length,
        mimeType,
      });

      return { mimeType, buffer };
    } catch (fetchError: any) {
      throw new Error(
        `Model returned a URL but failed to fetch image: ${fetchError.message}. ` +
        `URL: ${mediaUrl.substring(0, 100)}`
      );
    }
  }

  // Handle case where model returns raw base64 without data URL prefix
  // Check if the string looks like base64 (starts with valid base64 chars, is long enough)
  const base64Pattern = /^[A-Za-z0-9+/=]+$/;
  const trimmedUrl = mediaUrl.trim();
  if (trimmedUrl.length > 100 && base64Pattern.test(trimmedUrl.substring(0, 100))) {
    console.log('[story-image-flow] Model returned raw base64, attempting to decode as PNG');
    try {
      const buffer = Buffer.from(trimmedUrl, 'base64');
      // Check for PNG magic bytes (89 50 4E 47)
      if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        console.log('[story-image-flow] Detected PNG from raw base64, size:', buffer.length);
        return { mimeType: 'image/png', buffer };
      }
      // Check for JPEG magic bytes (FF D8 FF)
      if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        console.log('[story-image-flow] Detected JPEG from raw base64, size:', buffer.length);
        return { mimeType: 'image/jpeg', buffer };
      }
      // Check for WebP magic bytes (RIFF....WEBP)
      if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        console.log('[story-image-flow] Detected WebP from raw base64, size:', buffer.length);
        return { mimeType: 'image/webp', buffer };
      }
      // Default to PNG if we can't detect the type but it decoded successfully
      if (buffer.length > 1000) {
        console.log('[story-image-flow] Unknown image type from raw base64, assuming PNG, size:', buffer.length);
        return { mimeType: 'image/png', buffer };
      }
    } catch (decodeError) {
      console.log('[story-image-flow] Failed to decode as raw base64:', decodeError);
    }
  }

  // Handle malformed data URLs where the base64 marker might be slightly different
  // e.g., "data:image/png,base64,..." or "data:image/png; base64,..."
  const malformedMatch = /^data:([^,;]+)[,;]\s*base64[,;]\s*(.+)$/i.exec(mediaUrl);
  if (malformedMatch) {
    console.log('[story-image-flow] Detected malformed data URL, attempting to parse');
    const mimeType = malformedMatch[1].trim();
    const base64 = malformedMatch[2].trim();
    if (base64.length > 0) {
      return {
        mimeType: mimeType || 'image/png',
        buffer: Buffer.from(base64, 'base64'),
      };
    }
  }

  // Not a data URL and not a regular URL - provide diagnostic info
  const preview = mediaUrl.length > 200 ? mediaUrl.substring(0, 200) + '...' : mediaUrl;
  const startsWithData = mediaUrl.startsWith('data:');
  const hasBase64 = mediaUrl.includes(';base64,') || mediaUrl.includes(',base64,');
  const looksLikeBase64 = base64Pattern.test(trimmedUrl.substring(0, Math.min(100, trimmedUrl.length)));

  throw new Error(
    `Model returned an invalid media payload (the string did not match expected data URL format). ` +
    `Expected format: data:<mimeType>;base64,<data> or https://... URL. ` +
    `Starts with 'data:': ${startsWithData}. Contains base64 marker: ${hasBase64}. ` +
    `Looks like raw base64: ${looksLikeBase64}. ` +
    `Total length: ${mediaUrl.length} chars. ` +
    `First 200 chars: ${preview}`
  );
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'img';
}

function buildStoragePath(storyId: string, pageId: string, mimeType: string, storybookId?: string): string {
  // If storybookId is provided, include it in the path to allow multiple storybooks per story
  // New path: stories/{storyId}/storybooks/{storybookId}/pages/{pageId}.ext
  // Legacy path: stories/{storyId}/pages/{pageId}.ext
  const path = storybookId
    ? `stories/${storyId}/storybooks/${storybookId}/pages/${pageId}.${extensionFromMime(mimeType)}`
    : `stories/${storyId}/pages/${pageId}.${extensionFromMime(mimeType)}`;
  console.log(`[storyImageFlow] buildStoragePath: storybookId=${storybookId || 'undefined'}, path=${path}`);
  return path;
}

/**
 * Entity reference data including photos and character details for image generation
 */
type EntityReferenceData = {
  photos: string[];
  characters: Character[];
  childProfile?: ChildProfile;
  // Map of entity ID to full actor data (for structured prompts)
  actorMap: Map<string, Character | ChildProfile>;
};

/**
 * Structured actor data for image prompts
 */
type ActorData = {
  id: string;
  type: 'child' | 'sibling' | 'character';
  displayName: string;
  characterType?: string; // For characters: Pet, Friend, etc.
  description?: string;
  pronouns?: string;
  likes?: string[];
  dislikes?: string[];
  images: string[]; // Avatar + photos
};

/**
 * Build structured actor data from an entity
 */
function buildActorData(entity: Character | ChildProfile, entityId: string, isMainChild: boolean = false): ActorData {
  const images: string[] = [];
  if (entity.avatarUrl) images.push(entity.avatarUrl);
  if (entity.photos?.length) images.push(...entity.photos);

  // Check if it's a Character (has 'type' field) or ChildProfile
  const isCharacter = 'type' in entity && typeof (entity as Character).type === 'string';

  return {
    id: entityId,
    type: isCharacter ? 'character' : (isMainChild ? 'child' : 'sibling'),
    displayName: entity.displayName,
    characterType: isCharacter ? (entity as Character).type : undefined,
    description: entity.description,
    pronouns: entity.pronouns,
    likes: entity.likes,
    dislikes: entity.dislikes,
    images,
  };
}

/**
 * Build structured JSON for all actors in a scene
 * mainChild is always included if mainChildProfile is provided, even if not in actorIds
 * Other actors (siblings, characters) are included based on actorIds
 */
function buildActorsJson(
  actorIds: string[],
  actorMap: Map<string, Character | ChildProfile>,
  mainChildId?: string,
  mainChildProfile?: ChildProfile
): string {
  const actors: ActorData[] = [];
  const includedIds = new Set<string>();

  // Always add main child first if provided
  if (mainChildId && mainChildProfile) {
    actors.push(buildActorData(mainChildProfile, mainChildId, true));
    includedIds.add(mainChildId);
  }

  // Add other actors from the page's entityIds
  for (const actorId of actorIds) {
    // Skip if already added (e.g., main child)
    if (includedIds.has(actorId)) continue;

    const entity = actorMap.get(actorId);
    if (entity) {
      actors.push(buildActorData(entity, actorId, false));
      includedIds.add(actorId);
    }
  }

  if (actors.length === 0) {
    return '';
  }

  // Group by type for clarity
  const children = actors.filter(a => a.type === 'child');
  const siblings = actors.filter(a => a.type === 'sibling');
  const characters = actors.filter(a => a.type === 'character');

  const result: any = {};

  if (children.length > 0) {
    result.mainChild = children[0]; // There should only be one main child
  }

  if (siblings.length > 0) {
    result.siblings = siblings;
  }

  if (characters.length > 0) {
    result.characters = characters;
  }

  return JSON.stringify(result, null, 2);
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
 * Fetches reference photos/avatars AND full character details for entities based on their IDs.
 * Returns photos for visual reference and character objects for prompt enhancement.
 * Also builds an actorMap for structured prompt generation.
 */
async function fetchEntityReferenceData(
  firestore: FirebaseFirestore.Firestore,
  entityIds: string[]
): Promise<EntityReferenceData> {
  if (!entityIds || entityIds.length === 0) {
    return { photos: [], characters: [], actorMap: new Map() };
  }

  const photos: string[] = [];
  const characters: Character[] = [];
  const actorMap = new Map<string, Character | ChildProfile>();
  let childProfile: ChildProfile | undefined;
  // Filter out empty strings to prevent Firestore "documentPath must be non-empty" error
  const uniqueIds = [...new Set(entityIds)].filter(id => id && id.trim().length > 0);

  // Return early if all IDs were empty/invalid
  if (uniqueIds.length === 0) {
    return { photos: [], characters: [], actorMap: new Map() };
  }

  // Fetch in chunks of 10 (Firestore 'in' query limit)
  const chunkSize = 10;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);

    // Check characters collection first (by document ID)
    const characterSnapshot = await firestore
      .collection('characters')
      .where('__name__', 'in', chunk)
      .get();

    characterSnapshot.forEach((docSnap) => {
      const character = { id: docSnap.id, ...docSnap.data() } as Character;
      characters.push(character);
      actorMap.set(docSnap.id, character);
      // Use avatar URL if available
      if (character.avatarUrl) {
        photos.push(character.avatarUrl);
      }
    });

    // Find remaining IDs that weren't characters
    const foundCharacterIds = new Set(characterSnapshot.docs.map(d => d.id));
    const remainingChunk = chunk.filter(id => !foundCharacterIds.has(id));

    if (remainingChunk.length > 0) {
      // Check children collection (by document ID)
      const childSnapshot = await firestore
        .collection('children')
        .where('__name__', 'in', remainingChunk)
        .get();

      childSnapshot.forEach((docSnap) => {
        const child = { id: docSnap.id, ...docSnap.data() } as ChildProfile;
        childProfile = child;
        actorMap.set(docSnap.id, child);
        // Use child photos if available (take first 2)
        if (child.photos && child.photos.length > 0) {
          photos.push(...child.photos.slice(0, 2));
        } else if (child.avatarUrl) {
          photos.push(child.avatarUrl);
        }
      });
    }
  }

  // Fallback: For IDs not found by document ID, try to find by displayName
  // This handles legacy data where the AI used displayName instead of document ID
  const unfoundIds = uniqueIds.filter(id => !actorMap.has(id));
  if (unfoundIds.length > 0) {
    for (let i = 0; i < unfoundIds.length; i += chunkSize) {
      const chunk = unfoundIds.slice(i, i + chunkSize);

      // Try characters by displayName
      const charsByName = await firestore
        .collection('characters')
        .where('displayName', 'in', chunk)
        .get();

      charsByName.forEach((docSnap) => {
        const character = { id: docSnap.id, ...docSnap.data() } as Character;
        characters.push(character);
        // Map by displayName (which was used as the placeholder)
        actorMap.set(character.displayName, character);
        if (character.avatarUrl) {
          photos.push(character.avatarUrl);
        }
      });

      // Try children by displayName
      const stillUnfound = chunk.filter(id => !actorMap.has(id));
      if (stillUnfound.length > 0) {
        const childrenByName = await firestore
          .collection('children')
          .where('displayName', 'in', stillUnfound)
          .get();

        childrenByName.forEach((docSnap) => {
          const child = { id: docSnap.id, ...docSnap.data() } as ChildProfile;
          actorMap.set(child.displayName, child);
          if (child.photos && child.photos.length > 0) {
            photos.push(...child.photos.slice(0, 2));
          } else if (child.avatarUrl) {
            photos.push(child.avatarUrl);
          }
        });
      }
    }
  }

  return { photos, characters, childProfile, actorMap };
}

/**
 * Legacy function for backwards compatibility - returns only photos
 */
async function fetchEntityReferencePhotos(
  firestore: FirebaseFirestore.Firestore,
  entityIds: string[]
): Promise<string[]> {
  const data = await fetchEntityReferenceData(firestore, entityIds);
  return data.photos;
}

/**
 * Fetches ONLY avatar URLs for entities (not real photos).
 * Used for back cover generation which should only use avatars.
 */
async function fetchEntityAvatarsOnly(
  firestore: FirebaseFirestore.Firestore,
  entityIds: string[]
): Promise<string[]> {
  if (!entityIds || entityIds.length === 0) {
    return [];
  }

  const avatars: string[] = [];
  // Filter out empty strings to prevent Firestore "documentPath must be non-empty" error
  const uniqueIds = [...new Set(entityIds)].filter(id => id && id.trim().length > 0);

  // Return early if all IDs were empty/invalid
  if (uniqueIds.length === 0) {
    return [];
  }

  // Fetch in chunks of 10 (Firestore 'in' query limit)
  const chunkSize = 10;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);

    // Check characters collection first
    const characterSnapshot = await firestore
      .collection('characters')
      .where('__name__', 'in', chunk)
      .get();

    characterSnapshot.forEach((docSnap) => {
      const character = docSnap.data() as Character;
      // Only use avatar URL (not photos)
      if (character.avatarUrl) {
        avatars.push(character.avatarUrl);
      }
    });

    // Find remaining IDs that weren't characters
    const foundCharacterIds = new Set(characterSnapshot.docs.map(d => d.id));
    const remainingChunk = chunk.filter(id => !foundCharacterIds.has(id));

    if (remainingChunk.length > 0) {
      // Check children collection
      const childSnapshot = await firestore
        .collection('children')
        .where('__name__', 'in', remainingChunk)
        .get();

      childSnapshot.forEach((docSnap) => {
        const child = docSnap.data() as ChildProfile;
        // Only use avatar URL (not real photos)
        if (child.avatarUrl) {
          avatars.push(child.avatarUrl);
        }
      });
    }
  }

  return avatars;
}

async function uploadImageToStorage(params: {
  buffer: Buffer;
  mimeType: string;
  storyId: string;
  pageId: string;
  storybookId?: string;
  regressionTag?: string;
}) {
  let bucket;
  try {
    bucket = await getStoryBucket();
  } catch (err: any) {
    const message = err?.message || String(err);
    throw new Error(`BUCKET_UNAVAILABLE:${message}`);
  }
  const objectPath = buildStoragePath(params.storyId, params.pageId, params.mimeType, params.storybookId);
  const downloadToken = randomUUID();
  const metadata: Record<string, string> = {
    storyId: params.storyId,
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
        cacheControl: 'public,max-age=3600',
        metadata: {
          ...metadata,
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    objectPath
  )}?alt=media&token=${downloadToken}`;

  return {imageUrl, objectPath, downloadToken};
}

/**
 * Parameters for image creation with structured actor data
 */
type CreateImageParams = {
  sceneText: string;           // The scene text with $$Id$$ placeholders
  artStyle: string;            // Art style prompt
  actorsJson: string;          // Structured JSON of all actors in the scene
  childAge?: string;           // Age of the main child (e.g., "3 years old")
  mainChildId?: string;        // ID of the main child
  referencePhotos: string[];   // URLs of reference photos
  styleExampleImages?: string[]; // URLs of example images for art style reference
  targetWidthPx?: number;
  targetHeightPx?: number;
  aspectRatio?: string;
};

async function createImage(params: CreateImageParams): Promise<GenerateImageResult> {
  const {
    sceneText,
    artStyle,
    actorsJson,
    childAge,
    mainChildId,
    referencePhotos,
    styleExampleImages,
    targetWidthPx,
    targetHeightPx,
    aspectRatio,
  } = params;

  if (MOCK_IMAGES) {
    return buildMockSvg(sceneText, targetWidthPx, targetHeightPx);
  }

  // Fetch global image prompt configuration
  const globalImagePrompt = await getGlobalImagePrompt();

  // Fetch style example images first (these go before reference photos)
  const styleExampleParts = styleExampleImages && styleExampleImages.length > 0
    ? (await Promise.all(
        styleExampleImages.map(async (url) => {
          const dataUri = await fetchImageAsDataUri(url);
          return dataUri ? { media: { url: dataUri } } : null;
        })
      )).filter((part): part is { media: { url: string } } => part !== null)
    : [];

  const imageParts = (await Promise.all(
    referencePhotos.map(async (url) => {
      const dataUri = await fetchImageAsDataUri(url);
      return dataUri ? { media: { url: dataUri } } : null;
    })
  )).filter((part): part is { media: { url: string } } => part !== null);

  // Build dimension hint for the prompt if target dimensions are provided
  let dimensionHint = '';
  if (targetWidthPx && targetHeightPx) {
    const aspectRatioHint = targetWidthPx > targetHeightPx ? 'landscape' : targetWidthPx < targetHeightPx ? 'portrait' : 'square';
    dimensionHint = `\n\nOutput should be ${aspectRatioHint} orientation, approximately ${targetWidthPx}x${targetHeightPx} pixels.`;
  }

  // Build the structured prompt in the new format
  let structuredPrompt = '';

  // 0. Global image prompt (if configured)
  if (globalImagePrompt) {
    structuredPrompt += `${globalImagePrompt}\n\n`;
  }

  // 1. Target audience
  if (mainChildId && childAge) {
    structuredPrompt += `Create an image for a child's storybook. The main child ($$${mainChildId}$$) is ${childAge}.\n\n`;
  } else {
    structuredPrompt += `Create an image for a child's storybook.\n\n`;
  }

  // 2. Art style (with reference to example images if provided)
  if (styleExampleParts.length > 0) {
    structuredPrompt += `Art Style: ${artStyle}\n\nIMPORTANT: Use the first ${styleExampleParts.length} image(s) provided as visual style reference. Match their artistic style, color palette, line weight, and overall aesthetic closely.\n\n`;
  } else {
    structuredPrompt += `Art Style: ${artStyle}\n\n`;
  }

  // 3. Scene description with $$Id$$ placeholders intact
  structuredPrompt += `Scene: ${sceneText}\n\n`;

  // 4. Structured actor data
  if (actorsJson && actorsJson.length > 0) {
    structuredPrompt += `Characters in this scene (use the character reference images for visual reference):\n${actorsJson}\n`;
  }

  // 5. Dimension hints
  structuredPrompt += dimensionHint;

  // Build prompt variants for retry logic - progressively simplify on failure
  // The style example images are most likely to trigger copyright/recitation filters,
  // so we remove those first on retry while keeping reference photos and actor details
  const fullPromptText = structuredPrompt.trim();
  const noStyleExamplesPromptText = structuredPrompt.trim(); // Same text, just no style images
  const minimalPromptText = `Art Style: ${artStyle}\n\nScene: ${sceneText}${dimensionHint}`.trim();  // No actor details

  // Attempt 1: Full prompt with style examples, reference photos, and actor details
  const fullPromptParts: any[] = [
    ...styleExampleParts,
    ...imageParts,
    { text: fullPromptText },
  ];

  // Attempt 2: Remove style example images (most likely copyright trigger)
  // Keep reference photos and actor details for character consistency
  const noStyleExamplesPromptParts: any[] = [
    ...imageParts,
    { text: noStyleExamplesPromptText },
  ];

  // Attempt 3: Minimal - just art style text and scene, no images at all
  const minimalPromptParts: any[] = [
    { text: minimalPromptText },
  ];

  console.log('[story-image-flow] Generating image with model:', DEFAULT_IMAGE_MODEL);
  console.log('[story-image-flow] Prompt parts count:', fullPromptParts.length, 'Style examples:', styleExampleParts.length, 'Character refs:', imageParts.length);
  if (actorsJson) {
    console.log('[story-image-flow] Actors JSON length:', actorsJson.length);
  }
  if (targetWidthPx && targetHeightPx) {
    console.log('[story-image-flow] Target dimensions:', targetWidthPx, 'x', targetHeightPx);
  }
  if (aspectRatio) {
    console.log('[story-image-flow] Aspect ratio:', aspectRatio);
  }

  // Build the config with aspectRatio if provided
  // Gemini 2.5 Flash Image supports: 21:9, 16:9, 4:3, 3:2, 1:1, 9:16, 3:4, 2:3, 5:4, 4:5
  const generateConfig: any = {
    responseModalities: ['TEXT', 'IMAGE'],
  };
  if (aspectRatio) {
    generateConfig.imageConfig = { aspectRatio };
  }

  let generation;
  const MAX_RETRIES = 2;
  const GENERATION_TIMEOUT_MS = 120000; // 2 minute timeout for image generation
  let lastError: Error | null = null;
  let lastNoMediaReason: string | null = null;
  let retryReason: string | null = null; // Track why we're retrying for logging

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Use progressively simpler prompts on each retry
    let currentPromptParts: any[];
    let currentPromptText: string;

    if (attempt === 0) {
      currentPromptParts = fullPromptParts;
      currentPromptText = `${fullPromptText} [with ${styleExampleParts.length} style example(s), ${imageParts.length} reference photo(s), aspect=${aspectRatio || 'auto'}]`;
    } else if (attempt === 1) {
      currentPromptParts = noStyleExamplesPromptParts;
      currentPromptText = `${noStyleExamplesPromptText} [no style examples, ${imageParts.length} reference photo(s), aspect=${aspectRatio || 'auto'}]`;
      console.log(`[story-image-flow] Retry ${attempt}: Removing style example images (possible copyright trigger)`);
    } else {
      currentPromptParts = minimalPromptParts;
      currentPromptText = `${minimalPromptText} [minimal - no images, aspect=${aspectRatio || 'auto'}]`;
      console.log(`[story-image-flow] Retry ${attempt}: Using minimal prompt with no images`);
    }

    const startTime = Date.now();
    try {
      if (attempt > 0) {
        // Wait a bit before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }

      // Wrap ai.generate in a timeout to prevent hanging on rate limits
      const generatePromise = ai.generate({
        model: DEFAULT_IMAGE_MODEL,
        prompt: currentPromptParts,
        config: generateConfig,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Image generation timed out after ${GENERATION_TIMEOUT_MS / 1000} seconds. The API may be rate limited or experiencing issues.`));
        }, GENERATION_TIMEOUT_MS);
      });

      generation = await Promise.race([generatePromise, timeoutPromise]);
      console.log('[story-image-flow] Generation completed. Keys:', Object.keys(generation));
      await logAIFlow({
        flowName: 'storyImageFlow:createImage',
        sessionId: null,
        prompt: currentPromptText,
        response: generation,
        startTime,
        modelName: DEFAULT_IMAGE_MODEL,
        attemptNumber: attempt + 1,
        maxAttempts: MAX_RETRIES + 1,
        retryReason: retryReason || undefined,
      });

      // Check if we got media - if not, treat as retryable error
      if (!generation.media?.url) {
        const finishReason = generation.finishReason;
        const finishMessage = generation.finishMessage;
        const textResponse = generation.text?.substring(0, 200);

        console.warn(`[story-image-flow] No media in generation (attempt ${attempt + 1}):`, {
          finishReason,
          finishMessage,
          text: textResponse,
        });

        // Store the reason for the final error message and for retry logging
        lastNoMediaReason = finishMessage || textResponse || String(finishReason) || 'unknown';
        retryReason = `No media returned: ${lastNoMediaReason}`;

        if (attempt < MAX_RETRIES) {
          // Continue to next attempt with simpler prompt
          console.log(`[story-image-flow] No image returned, will retry with simpler prompt`);
          continue;
        }
        // Final attempt - fall through to error handling below
      } else {
        // Success - we have media
        lastError = null;
        lastNoMediaReason = null;
        break;
      }
    } catch (e: any) {
      lastError = e;
      const errorMessage = e?.message || String(e);
      console.error(`[story-image-flow] Generation failed (attempt ${attempt + 1}):`, errorMessage);
      await logAIFlow({
        flowName: 'storyImageFlow:createImage',
        sessionId: null,
        prompt: currentPromptText,
        error: e,
        startTime,
        modelName: DEFAULT_IMAGE_MODEL,
        attemptNumber: attempt + 1,
        maxAttempts: MAX_RETRIES + 1,
        retryReason: retryReason || undefined,
      });

      // Set retry reason for next attempt's log
      retryReason = `Exception: ${errorMessage.substring(0, 100)}`;

      // Check if this is a retryable error
      const isPatternError = errorMessage.includes('did not match the expected pattern');
      const isRateLimitError = errorMessage.includes('RESOURCE_EXHAUSTED') ||
                               errorMessage.includes('429') ||
                               errorMessage.includes('quota') ||
                               errorMessage.includes('rate') ||
                               errorMessage.includes('timed out');
      const isTransientError = isRateLimitError ||
                               errorMessage.includes('UNAVAILABLE') ||
                               errorMessage.includes('DEADLINE_EXCEEDED') ||
                               errorMessage.includes('temporarily');

      if (!isPatternError && !isTransientError) {
        // Non-retryable error, throw immediately
        throw e;
      }

      if (attempt === MAX_RETRIES) {
        // Final attempt failed - provide clear error messages
        if (isRateLimitError) {
          throw new Error(
            `Image generation failed: Rate limit exceeded or timeout. ` +
            `The Gemini API quota has been exhausted. Please wait a few minutes and try again. ` +
            `Original error: ${errorMessage}`
          );
        }
        if (isPatternError) {
          // Truncate prompt for error message (keep it readable but include key info)
          const promptPreview = currentPromptText.length > 300
            ? currentPromptText.substring(0, 300) + '...'
            : currentPromptText;
          throw new Error(
            `Image generation failed after ${MAX_RETRIES + 1} attempts. ` +
            `The AI model rejected the prompt (pattern validation error). ` +
            `This may be due to content filtering. Try regenerating with a different prompt. ` +
            `Prompt: "${promptPreview}" ` +
            `Original error: ${errorMessage}`
          );
        }
        throw e;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  if (!generation) {
    throw new Error('Image generation failed: no response received after retries.');
  }

  const media = generation.media;
  if (!media?.url) {
    // Log what we got from the generation
    const finishReason = generation.finishReason;
    const finishMessage = generation.finishMessage;
    const textResponse = generation.text?.substring(0, 200);

    console.error('[story-image-flow] No media.url in generation after all retries:', {
      hasMedia: !!media,
      mediaKeys: media ? Object.keys(media) : [],
      generationKeys: Object.keys(generation),
      finishReason,
      finishMessage,
      text: textResponse,
    });

    // Provide a more helpful error message
    // Note: finishReason types from Genkit may not cover all Gemini-specific reasons,
    // so we cast to string for comparison
    const reason = String(finishReason || '');

    let errorMessage: string;
    if (reason === 'blocked' || reason === 'safety' || reason.includes('SAFETY')) {
      errorMessage = 'Image was blocked by content safety filters after 3 attempts with progressively simpler prompts. The scene description may contain content that cannot be rendered.';
    } else if (reason === 'recitation' || reason.includes('RECITATION')) {
      errorMessage = 'Image was blocked due to copyright/recitation concerns. Try using a different art style.';
    } else if (lastNoMediaReason) {
      errorMessage = `Image could not be generated after 3 attempts. Last reason: ${lastNoMediaReason}`;
    } else if (textResponse) {
      errorMessage = `Image not generated after 3 attempts. Model response: "${textResponse}"`;
    } else {
      errorMessage = `Image generation failed after 3 attempts with progressively simpler prompts. The scene may contain content that triggers safety filters.`;
    }

    throw new Error(errorMessage);
  }

  console.log('[story-image-flow] Parsing media URL:', {
    type: typeof media.url,
    length: media.url?.length,
    startsWithData: typeof media.url === 'string' && media.url.startsWith('data:'),
    hasBase64Marker: typeof media.url === 'string' && media.url.includes(';base64,'),
    first50Chars: typeof media.url === 'string' ? media.url.substring(0, 50) : 'N/A',
  });

  const {mimeType, buffer} = await parseMediaUrl(media.url);
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
  async ({storyId, pageId, regressionTag, forceRegenerate, storybookId, targetWidthPx, targetHeightPx, imageStylePrompt, imageStyleId, aspectRatio}) => {
    console.log(`[storyImageFlow] Called with storyId=${storyId}, pageId=${pageId}, storybookId=${storybookId || 'undefined'}, imageStyleId=${imageStyleId || 'undefined'}, aspectRatio=${aspectRatio || 'auto'}`);
    const logs: string[] = [];
    await initFirebaseAdminApp();
    const firestore = getFirestore();
    const storyRef = firestore.collection('stories').doc(storyId);
    let generated: GenerateImageResult | null = null;

    // Determine the page path based on whether we're using new or legacy model
    // New model: stories/{storyId}/storybooks/{storybookId}/pages/{pageId}
    // Legacy model: stories/{storyId}/outputs/storybook/pages/{pageId}
    const pageRef = storybookId
      ? storyRef.collection('storybooks').doc(storybookId).collection('pages').doc(pageId)
      : storyRef.collection('outputs').doc('storybook').collection('pages').doc(pageId);

    logs.push(`[path] Using ${storybookId ? 'new' : 'legacy'} model path: ${pageRef.path}`);

    try {
      logs.push(`[step] Loading story document...`);
      const storySnap = await storyRef.get();
      if (!storySnap.exists) {
        throw new Error(`stories/${storyId} not found.`);
      }
      const storyData = storySnap.data() as Story;
      logs.push(`[step] Story loaded. childId=${storyData.childId || 'none'}`);

      let childProfile: ChildProfile | null = null;
      if (isValidDocumentId(storyData.childId)) {
        logs.push(`[step] Loading child profile for ${storyData.childId}...`);
        const childSnap = await firestore.collection('children').doc(storyData.childId).get();
        if (childSnap.exists) {
          childProfile = childSnap.data() as ChildProfile;
          logs.push(`[step] Child profile loaded: ${childProfile.displayName}`);
        } else {
          logs.push(`[step] Child profile not found for ${storyData.childId}`);
        }
      }

      logs.push(`[step] Loading page document...`);
      const pageSnap = await pageRef.get();
      if (!pageSnap.exists) {
        throw new Error(`Page document not found at ${pageRef.path}`);
      }
      const page = pageSnap.data() as StoryOutputPage;
      logs.push(`[step] Page loaded. entityIds=${JSON.stringify(page.entityIds || [])}`);

      // Log any empty entityIds for debugging
      const emptyIds = (page.entityIds || []).filter((id: string) => !id || id.trim().length === 0);
      if (emptyIds.length > 0) {
        logs.push(`[warning] Page has ${emptyIds.length} empty entityIds`);
      }
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

      await pageRef.update({
        imageStatus: 'generating',
        'imageMetadata.lastErrorMessage': null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        // Collect reference photos AND character details from entities mentioned on this page
        const entityData = await fetchEntityReferenceData(firestore, page.entityIds ?? []);
        logs.push(`[entities] Found ${page.entityIds?.length ?? 0} entity IDs, ${entityData.photos.length} reference photos, ${entityData.actorMap.size} actors resolved`);

        // Calculate child's age for the prompt
        let childAge: string | undefined;
        if (childProfile?.dateOfBirth) {
          const dob = typeof (childProfile.dateOfBirth as any).toDate === 'function'
            ? (childProfile.dateOfBirth as any).toDate()
            : new Date(childProfile.dateOfBirth as any);
          const ageMs = Date.now() - dob.getTime();
          const ageYears = Math.floor(ageMs / (1000 * 60 * 60 * 24 * 365.25));
          childAge = `${ageYears} years old`;
        }

        // Build structured actors JSON for the prompt
        // Always include main child (with full profile), plus all actors from page.entityIds
        const actorsJson = buildActorsJson(
          page.entityIds ?? [],
          entityData.actorMap,
          storyData.childId,
          childProfile ?? undefined
        );
        if (actorsJson) {
          logs.push(`[actors] Structured JSON built: mainChild=${!!childProfile}, pageActors=${entityData.actorMap.size}`);
        }

        // For back cover, use ONLY avatars (not real photos)
        // For other pages, combine child photos with entity reference photos
        let referencePhotos: string[];
        if (page.kind === 'cover_back') {
          // Back cover: use only avatars from actors
          const avatarsOnly = await fetchEntityAvatarsOnly(firestore, page.entityIds ?? []);
          referencePhotos = avatarsOnly.slice(0, 5);
          logs.push(`[back-cover] Using ${referencePhotos.length} avatar(s) only (no real photos)`);
        } else {
          // Other pages: combine child photos with entity reference photos (child photos take priority)
          const childPhotos = childProfile?.photos?.slice(0, 3) ?? [];
          const allReferencePhotos = [...childPhotos, ...entityData.photos];
          // Limit to reasonable number of reference images
          referencePhotos = allReferencePhotos.slice(0, 5);
        }

        // Priority for art style:
        // 1. Explicitly passed imageStylePrompt (new model)
        // 2. Legacy selectedImageStylePrompt on story document
        // 3. artStyleHint in metadata
        // 4. Default watercolor style
        const artStyle = imageStylePrompt
          ?? (storyData as any).selectedImageStylePrompt
          ?? storyData.metadata?.artStyleHint
          ?? "a gentle, vibrant watercolor style";

        // Load example images from imageStyles collection if imageStyleId is provided
        let styleExampleImages: string[] = [];
        if (isValidDocumentId(imageStyleId)) {
          try {
            const styleSnap = await firestore.collection('imageStyles').doc(imageStyleId).get();
            if (styleSnap.exists) {
              const styleData = styleSnap.data() as ImageStyle;
              if (styleData.exampleImages && styleData.exampleImages.length > 0) {
                styleExampleImages = styleData.exampleImages.map(img => img.url);
                logs.push(`[styleExamples] Loaded ${styleExampleImages.length} example images from style ${imageStyleId}`);
              }
            } else {
              logs.push(`[styleExamples] Style ${imageStyleId} not found`);
            }
          } catch (styleError: any) {
            logs.push(`[styleExamples] Failed to load style ${imageStyleId}: ${styleError?.message ?? styleError}`);
          }
        }

        // Log target dimensions and aspect ratio if provided
        if (targetWidthPx && targetHeightPx) {
          logs.push(`[dimensions] Target: ${targetWidthPx}x${targetHeightPx}px`);
        }
        if (aspectRatio) {
          logs.push(`[aspectRatio] ${aspectRatio}`);
        }

        // Use imageDescription (from pagination flow) as the scene text, with fallbacks
        // Priority: imageDescription > bodyText > imagePrompt
        const sceneText = page.imageDescription || page.bodyText || page.imagePrompt;

        generated = await createImage({
          sceneText,
          artStyle,
          actorsJson,
          childAge,
          mainChildId: storyData.childId,
          referencePhotos,
          styleExampleImages,
          targetWidthPx,
          targetHeightPx,
          aspectRatio,
        });
      } catch (generationError: any) {
        const fallbackAllowed = MOCK_IMAGES || !!regressionTag || process.env.STORYBOOK_IMAGE_FALLBACK === 'true';
        const errMessage = generationError?.message ?? String(generationError);
        console.error('[story-image-flow] Image generation error for page', pageId, ':', errMessage);
        logs.push(`[warn] Image model failed for ${pageId}: ${errMessage}`);

        // Update the page with the error details immediately so user can see it
        await pageRef.update({
          imageStatus: 'error',
          'imageMetadata.lastErrorMessage': errMessage,
          updatedAt: FieldValue.serverTimestamp(),
        });

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
          storyId,
          pageId,
          storybookId,
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

      await pageRef.update({
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
          regressionTag: regressionTag ?? (page as any).regressionTag ?? null,
          generatedAt: FieldValue.serverTimestamp(),
          lastErrorMessage: null,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Atomically increment the storybook's pagesReady counter for real-time progress updates
      // This allows parallel image generation while still showing incremental progress
      if (storybookId) {
        const storybookRef = storyRef.collection('storybooks').doc(storybookId);
        await storybookRef.update({
          'imageGeneration.pagesReady': FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      logs.push(`[success] Generated art for ${pageId}`);
      return {
        ok: true as const,
        storyId,
        pageId,
        imageUrl: uploadResult.imageUrl,
        imageStatus: 'ready' as const,
        logs,
      };
    } catch (error: any) {
      const message = error?.message ?? 'storyImageFlow failed.';
      const stack = error?.stack ?? 'No stack trace available';
      // Log the full stack trace for debugging
      console.error(`[storyImageFlow] Error for page ${pageId}:`, message);
      console.error(`[storyImageFlow] Stack trace:`, stack);
      try {
        await pageRef.update({
          imageStatus: 'error',
          'imageMetadata.lastErrorMessage': message,
          'imageMetadata.errorStack': stack.substring(0, 1000), // Store first 1000 chars of stack
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (updateError) {
        logs.push(`[warn] Failed to record error state: ${(updateError as Error)?.message}`);
      }
      logs.push(`[error] ${message}`);
      logs.push(`[stack] ${stack.substring(0, 500)}`);

      // Gather extended diagnostics for maintenance notification
      let extendedDiagnostics: Record<string, any> = {
        // Core identifiers
        storyId,
        pageId,
        storybookId: storybookId || null,

        // Configuration
        imageStyleId: imageStyleId || null,
        imageStylePrompt: imageStylePrompt ? imageStylePrompt.substring(0, 100) + '...' : null,
        aspectRatio: aspectRatio || null,
        targetDimensions: targetWidthPx && targetHeightPx ? `${targetWidthPx}x${targetHeightPx}px` : null,

        // Model info
        model: DEFAULT_IMAGE_MODEL,
        mockImagesEnabled: MOCK_IMAGES,

        // Logs for debugging
        logs,
      };

      // Try to fetch additional context for the notification
      try {
        const storySnap = await storyRef.get();
        if (storySnap.exists) {
          const storyData = storySnap.data() as Story;
          extendedDiagnostics.story = {
            title: storyData.metadata?.title || null,
            childId: storyData.childId || null,
            parentUid: storyData.parentUid || null,
            storySessionId: storyData.storySessionId || null,
          };
        }

        const pageSnap = await pageRef.get();
        if (pageSnap.exists) {
          const page = pageSnap.data() as StoryOutputPage;
          extendedDiagnostics.page = {
            kind: page.kind || null,
            pageNumber: page.pageNumber || null,
            entityIds: page.entityIds || [],
            imagePromptPreview: page.imagePrompt ? page.imagePrompt.substring(0, 150) + '...' : null,
            imageDescription: page.imageDescription ? page.imageDescription.substring(0, 150) + '...' : null,
            hasBodyText: !!page.bodyText,
          };
        }
      } catch (contextError) {
        logs.push(`[warn] Failed to gather extended diagnostics: ${(contextError as Error)?.message}`);
      }

      // Send maintenance error notification email
      try {
        await notifyMaintenanceError(firestore, {
          flowName: 'storyImageFlow',
          errorType: 'ImageGenerationFailed',
          errorMessage: message,
          pagePath: `/storybook/${storybookId || storyId}?storyId=${storyId}`,
          diagnostics: extendedDiagnostics,
          timestamp: new Date(),
        });
        logs.push('[email] Maintenance error notification sent');
      } catch (emailError: any) {
        // Don't fail the flow if email fails - just log it
        logs.push(`[warn] Failed to send maintenance notification: ${emailError?.message ?? emailError}`);
      }

      return {
        ok: false as const,
        storyId,
        pageId,
        imageStatus: 'error' as const,
        errorMessage: message,
        logs,
      };
    }
  }
);
