/**
 * Picture pages that fill the interior's padding (the product's page minimum
 * and multiple can leave several pages after "The End"): a scrapbook of the
 * Book's own pictures, each in an instant-photo frame with a soft shadow and a
 * strip of tape, tilted a few degrees, on a warm paper background. The first
 * one carries a heading. Pure drawing: the images are already embedded.
 */
import { degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export const COLLAGE_HEADING = 'Pictures from our adventure';
const PER_PAGE = 3;
const PAPER = rgb(0.985, 0.962, 0.918);
const HEADING = rgb(0.42, 0.28, 0.16);
const TAPE = rgb(0.95, 0.88, 0.66);
const ANGLES = [-6, 4, -3, 5, -4, 3, -5, 6, -2];
const POINTS_PER_INCH = 72;
/** Nothing closer to the trim than this: the binder's safe zone. */
const SAFE_MARGIN_IN = 0.35;

/** Centre (fractions of the trim, from its top-left) and width (fraction of the trim width). */
type Slot = { cx: number; cy: number; w: number };

const LANDSCAPE: Record<number, Slot[]> = {
  1: [{ cx: 0.5, cy: 0.52, w: 0.6 }],
  2: [
    { cx: 0.29, cy: 0.5, w: 0.44 },
    { cx: 0.71, cy: 0.53, w: 0.44 },
  ],
  3: [
    { cx: 0.23, cy: 0.58, w: 0.41 },
    { cx: 0.51, cy: 0.4, w: 0.42 },
    { cx: 0.78, cy: 0.6, w: 0.39 },
  ],
};
const PORTRAIT: Record<number, Slot[]> = {
  1: [{ cx: 0.5, cy: 0.5, w: 0.75 }],
  2: [
    { cx: 0.45, cy: 0.29, w: 0.7 },
    { cx: 0.55, cy: 0.72, w: 0.7 },
  ],
  3: [
    { cx: 0.35, cy: 0.24, w: 0.58 },
    { cx: 0.65, cy: 0.5, w: 0.58 },
    { cx: 0.37, cy: 0.77, w: 0.58 },
  ],
};
/** Tallest a photo may be, as a fraction of the trim height, by photos per page. */
const MAX_HEIGHT: Record<'landscape' | 'portrait', Record<number, number>> = {
  landscape: { 1: 0.7, 2: 0.62, 3: 0.56 },
  portrait: { 1: 0.6, 2: 0.38, 3: 0.27 },
};

type Point = { x: number; y: number };

function rotate(p: Point, angle: number): Point {
  const r = (angle * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
}

/**
 * pdf-lib rotates a rectangle or image about its bottom-left corner. To turn
 * one about the frame's centre, work out where that corner lands: the
 * element's centre is offset from the frame centre (turned with the frame),
 * and its corner is half its size from there (turned with the element).
 */
function corner(centre: Point, frameAngle: number, offset: Point, size: { w: number; h: number }, angle: number): Point {
  const c = rotate(offset, frameAngle);
  const half = rotate({ x: -size.w / 2, y: -size.h / 2 }, angle);
  return { x: centre.x + c.x + half.x, y: centre.y + c.y + half.y };
}

/** Which pictures go on padding page `index`: consecutive ones, so pages differ, wrapping round. */
export function collagePictures<T>(pictures: T[], index: number): T[] {
  if (pictures.length === 0) return [];
  const count = Math.min(PER_PAGE, pictures.length);
  return Array.from({ length: count }, (_, k) => pictures[(index * count + k) % pictures.length]);
}

export function drawCollagePage(input: {
  page: PDFPage;
  pictures: PDFImage[];
  /** The padding page's position, 0 for the first (which carries the heading). */
  index: number;
  font: PDFFont;
  trim: { widthIn: number; heightIn: number };
  bleedIn: number;
}): void {
  const { page, font, trim, bleedIn, index } = input;
  const W = trim.widthIn * POINTS_PER_INCH;
  const H = trim.heightIn * POINTS_PER_INCH;
  const bleed = bleedIn * POINTS_PER_INCH;
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: PAPER });

  const heading = index === 0;
  if (heading) {
    const size = Math.min(40, H * 0.065);
    const width = font.widthOfTextAtSize(COLLAGE_HEADING, size);
    page.drawText(COLLAGE_HEADING, { x: bleed + (W - width) / 2, y: bleed + H * 0.9, font, size, color: HEADING });
  }

  const pictures = collagePictures(input.pictures, index);
  if (pictures.length === 0) return;
  const orientation = W >= H ? 'landscape' : 'portrait';
  const slots = (orientation === 'landscape' ? LANDSCAPE : PORTRAIT)[pictures.length];
  const maxHeight = MAX_HEIGHT[orientation][pictures.length] * H * (heading ? 0.9 : 1);

  pictures.forEach((image, k) => {
    const slot = slots[k];
    // Below the heading on the first page: squeeze the slots into the lower part.
    const cy = heading ? 0.14 + slot.cy * 0.86 : slot.cy;
    const aspect = image.width / image.height;
    let w = slot.w * W * (heading ? 0.92 : 1);
    let h = w / aspect;
    if (h > maxHeight) {
      h = maxHeight;
      w = h * aspect;
    }
    const border = w * 0.045;
    const frame = { w: w + 2 * border, h: h + 4 * border }; // a deeper border at the bottom
    const angle = ANGLES[(index * PER_PAGE + k) % ANGLES.length];
    // Keep the turned frame (and its shadow) inside the safe zone, and under the heading.
    const r = (Math.abs(angle) * Math.PI) / 180;
    const halfW = (frame.w * Math.cos(r) + frame.h * Math.sin(r)) / 2 + border;
    const halfH = (frame.w * Math.sin(r) + frame.h * Math.cos(r)) / 2 + border;
    const margin = SAFE_MARGIN_IN * POINTS_PER_INCH;
    const top = bleed + (heading ? H * 0.86 : H - margin);
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
    const centre = {
      x: clamp(bleed + slot.cx * W, bleed + margin + halfW, bleed + W - margin - halfW),
      y: clamp(bleed + (1 - cy) * H, bleed + margin + halfH, top - halfH),
    };

    const shadowAt = corner({ x: centre.x + border * 0.6, y: centre.y - border * 0.8 }, angle, { x: 0, y: 0 }, frame, angle);
    page.drawRectangle({ ...shadowAt, width: frame.w, height: frame.h, rotate: degrees(angle), color: rgb(0, 0, 0), opacity: 0.16 });

    const frameAt = corner(centre, angle, { x: 0, y: 0 }, frame, angle);
    page.drawRectangle({
      ...frameAt,
      width: frame.w,
      height: frame.h,
      rotate: degrees(angle),
      color: rgb(1, 1, 1),
      borderColor: rgb(0.86, 0.84, 0.8),
      borderWidth: 0.6,
    });

    // The photo sits higher in the frame than its centre: one border on top, three below.
    const photoAt = corner(centre, angle, { x: 0, y: border }, { w, h }, angle);
    page.drawImage(image, { ...photoAt, width: w, height: h, rotate: degrees(angle) });

    const tape = { w: frame.w * 0.3, h: frame.w * 0.075 };
    const tapeAngle = angle + (k % 2 === 0 ? 7 : -7);
    const tapeAt = corner(centre, angle, { x: 0, y: frame.h / 2 }, tape, tapeAngle);
    page.drawRectangle({ ...tapeAt, width: tape.w, height: tape.h, rotate: degrees(tapeAngle), color: TAPE, opacity: 0.78 });
  });
}
