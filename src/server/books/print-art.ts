/**
 * Print copies of a Book's pictures (`book.printArt`).
 *
 * A Book is drawn for the screen (4:5). A print template puts each picture in
 * a box of its own shape (`Layout.imageAspects`). Rather than redrawing the
 * Book, each finished screen picture gets a print copy at the box's shape:
 *
 *   - shapes close (within CROP_TOLERANCE): crop the centre, no AI, the
 *     picture is otherwise identical;
 *   - shapes far apart: the image model extends this exact picture to the new
 *     shape (more scene at the edges), then the result is cropped to the exact
 *     box shape, since the model only draws a few fixed ratios.
 *
 * The screen pictures are never changed, so a child's Book stays as it is.
 */
import { artAspectRatio, type ArtPageKind, type Layout } from '../catalog';

/** Largest shape difference cropped without AI: |ln(source / target)|, about 12%. */
export const CROP_TOLERANCE = 0.12;

const IMAGE_ASPECT_FOR: Record<ArtPageKind, keyof Layout['imageAspects']> = { cover: 'cover', story: 'inside', back: 'back' };

/** Width / height of the box this page's picture fills in the template, or null when it defines none. */
export function printAspectFor(layout: Layout, kind: ArtPageKind): number | null {
  return layout.imageAspects[IMAGE_ASPECT_FOR[kind]] ?? layout.aspect ?? null;
}

export function printArtMethod(source: number, target: number): 'crop' | 'extend' {
  return Math.abs(Math.log(source / target)) <= CROP_TOLERANCE ? 'crop' : 'extend';
}

/** The ratio the image model is asked for when extending: the nearest it draws. */
export function extendRatio(layout: Layout, kind: ArtPageKind): string {
  return artAspectRatio(layout, kind);
}

async function sharp() {
  return (await import('sharp')).default;
}

export async function imageSize(data: Buffer): Promise<{ width: number; height: number }> {
  const meta = await (await sharp())(data).metadata();
  if (!meta.width || !meta.height) throw new Error('Unreadable picture');
  return { width: meta.width, height: meta.height };
}

/** The centre of the picture at exactly `aspect` (width / height), as PNG. */
export async function cropToAspect(data: Buffer, aspect: number): Promise<{ data: Buffer; width: number; height: number }> {
  const { width, height } = await imageSize(data);
  let w = width;
  let h = height;
  if (width / height > aspect) w = Math.max(1, Math.round(height * aspect));
  else h = Math.max(1, Math.round(width / aspect));
  const left = Math.floor((width - w) / 2);
  const top = Math.floor((height - h) / 2);
  const out = await (await sharp())(data).extract({ left, top, width: w, height: h }).png().toBuffer();
  return { data: out, width: w, height: h };
}

/** The instruction sent with the picture when extending it. */
export function extendPrompt(kind: ArtPageKind): string {
  const lines = [
    "The attached image is a finished illustration from a children's picture book.",
    'Recreate this same illustration at the new image shape by extending the scene outward at the edges.',
    'Keep everything already in the picture the same: the characters, their faces, hair, clothes and poses,',
    'the objects, the colours, the lighting and the art style. Do not move, resize, crop or redraw them differently.',
    'Only paint more of the surrounding scene where the canvas grows, continuing it naturally in the same style.',
  ];
  if (kind === 'cover') {
    lines.push('Keep the existing title lettering exactly as it is, in the same place relative to the picture. Add no other words.');
  } else {
    lines.push('Add no words, letters or numbers.');
  }
  return lines.join('\n');
}
