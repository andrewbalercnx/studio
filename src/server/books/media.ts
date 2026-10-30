/**
 * Media helpers for the Book pipeline: fetching reference images, decoding
 * model output, and storing files. Injected into job handlers through
 * `BookJobDeps` so tests run without network or Storage.
 *
 * Storage paths are per Book (or Manuscript) AND per job attempt, so a retry
 * never overwrites a file a document already points at (as-is pipeline bugs 6
 * and 7; ADR-0010 spirit):
 *   books/{bookId}/castSheets/{castId}/{jobId}-{attempt}.{ext}
 *   books/{bookId}/pages/{n}/{jobId}-{attempt}.{ext}
 *   manuscripts/{manuscriptId}/narration/{n}/{jobId}-{attempt}.mp3
 */
import { randomUUID } from 'node:crypto';

export type StoredFile = { url: string; storagePath: string };

export interface BlobStore {
  save(storagePath: string, data: Buffer, contentType: string, metadata?: Record<string, string>): Promise<StoredFile>;
}

/** Firebase Storage with a download-token URL, as today's flows write. */
export const firebaseBlobStore: BlobStore = {
  async save(storagePath, data, contentType, metadata = {}) {
    const { getStoryBucket } = await import('@/firebase/admin/storage');
    const bucket = await getStoryBucket();
    const token = randomUUID();
    await bucket.file(storagePath).save(data, {
      contentType,
      resumable: false,
      metadata: {
        cacheControl: 'public,max-age=86400',
        metadata: { ...metadata, firebaseStorageDownloadTokens: token },
      },
    });
    return {
      storagePath,
      url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
    };
  },
};

export type FetchImage = (url: string) => Promise<string | null>;

/** Fetch an image as a data URI for a multimodal prompt; null when it cannot be fetched. */
export const fetchImageAsDataUri: FetchImage = async (url) => {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.warn(`[books/media] Failed to fetch reference image (${response.status})`);
      return null;
    }
    const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.warn('[books/media] Failed to fetch reference image', (error as Error)?.message ?? error);
    return null;
  }
};

function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Decode what an image model returned (ported from story-image-flow's
 * parseMediaUrl): a data URL, a slightly malformed data URL, raw base64, or an
 * https URL to fetch.
 */
export async function decodeMedia(mediaUrl: string): Promise<{ contentType: string; data: Buffer }> {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(mediaUrl);
  if (match) return { contentType: match[1], data: Buffer.from(match[2], 'base64') };
  const malformed = /^data:([^,;]+)[,;]\s*base64[,;]\s*([\s\S]+)$/i.exec(mediaUrl);
  if (malformed) return { contentType: malformed[1].trim() || 'image/png', data: Buffer.from(malformed[2].trim(), 'base64') };
  if (/^https?:\/\//.test(mediaUrl)) {
    const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Model returned a URL that could not be fetched (${response.status})`);
    return {
      contentType: (response.headers.get('content-type') || 'image/png').split(';')[0].trim(),
      data: Buffer.from(await response.arrayBuffer()),
    };
  }
  const trimmed = mediaUrl.trim();
  if (trimmed.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    const data = Buffer.from(trimmed, 'base64');
    const contentType = sniffImageType(data);
    if (contentType) return { contentType, data };
  }
  throw new Error(`Model returned an unreadable media payload (${mediaUrl.length} chars)`);
}

export function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    default:
      return 'bin';
  }
}
