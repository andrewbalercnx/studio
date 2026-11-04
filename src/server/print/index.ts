/**
 * Print (slice 5.5): Book → print render (PDFs) → orders.
 * See docs/architecture/target/slices/5.5-print-orders.md.
 */
import { getDb } from '../data/db';
import { getJobRunner } from '../jobs';
import type { PrintImage } from './render';
import type { RenderJobDeps } from './jobs';
import type { PrintServiceDeps } from './service';

export * from './service';
export { registerPrintJobs, RENDER_JOB_KIND, renderSpec, renderStoragePath } from './jobs';

/** Fetch picture bytes for a PDF. pdf-lib embeds PNG and JPEG; WebP is converted to PNG. */
export async function fetchPrintImage(url: string): Promise<PrintImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.warn(`[print] Failed to fetch picture (${response.status})`);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { bytes, type: 'png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, type: 'jpeg' };
    const sharp = (await import('sharp')).default;
    return { bytes: new Uint8Array(await sharp(bytes).png().toBuffer()), type: 'png' };
  } catch (error) {
    console.warn('[print] Failed to fetch picture', (error as Error)?.message ?? error);
    return null;
  }
}

export async function defaultRenderJobDeps(): Promise<RenderJobDeps> {
  const { firebaseBlobStore } = await import('../books/media');
  return { blobs: firebaseBlobStore, fetchImage: fetchPrintImage };
}

export async function getPrintServiceDeps(): Promise<PrintServiceDeps> {
  return { db: await getDb(), runner: getJobRunner() };
}

export async function getPrintReadDb() {
  return getDb();
}
