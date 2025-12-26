import { PRINT_DPI, DEFAULT_PRINT_LAYOUT_ID, type PrintLayout, type PageLayoutConfig, type PrintLayoutPageType } from './types';

/**
 * Get the layout configuration for a specific page type (cover, inside, backCover, titlePage).
 * Falls back to legacy textBoxes/imageBoxes arrays if page-specific layouts are not defined.
 */
export function getLayoutForPageType(
  layout: PrintLayout,
  pageType: PrintLayoutPageType
): PageLayoutConfig {
  // Try page-specific layouts first
  switch (pageType) {
    case 'cover':
      if (layout.coverLayout) return layout.coverLayout;
      break;
    case 'backCover':
      if (layout.backCoverLayout) return layout.backCoverLayout;
      break;
    case 'titlePage':
      // Title page: use titlePageLayout if defined, otherwise return full-page text box (no image)
      if (layout.titlePageLayout) return layout.titlePageLayout;
      // Default: full-page text box centered
      return {
        textBox: {
          x: 0.5,
          y: 0.5,
          width: layout.leafWidth - 1,
          height: layout.leafHeight - 1,
        },
        // No image box for title page
      };
    case 'inside':
      if (layout.insideLayout) return layout.insideLayout;
      break;
  }

  // Fallback to legacy arrays (used for inside pages or if no specific layout defined)
  return {
    textBox: layout.textBoxes?.[0]
      ? {
          x: layout.textBoxes[0].x,
          y: layout.textBoxes[0].y,
          width: layout.textBoxes[0].width,
          height: layout.textBoxes[0].height,
        }
      : undefined,
    imageBox: layout.imageBoxes?.[0]
      ? {
          x: layout.imageBoxes[0].x,
          y: layout.imageBoxes[0].y,
          width: layout.imageBoxes[0].width,
          height: layout.imageBoxes[0].height,
        }
      : undefined,
  };
}

/**
 * Map StoryOutputPage.kind to PrintLayoutPageType.
 */
export function mapPageKindToLayoutType(
  kind: 'cover_front' | 'cover_back' | 'title_page' | 'text' | 'image' | 'blank'
): PrintLayoutPageType {
  switch (kind) {
    case 'cover_front':
      return 'cover';
    case 'cover_back':
      return 'backCover';
    case 'title_page':
      return 'titlePage';
    case 'text':
    case 'image':
    case 'blank':
    default:
      return 'inside';
  }
}

/**
 * Calculate pixel dimensions for image generation based on a print layout's image box
 * for a specific page type.
 * Uses PRINT_DPI (300) to convert inches to pixels.
 */
export function calculateImageDimensionsForPageType(
  layout: PrintLayout,
  pageType: PrintLayoutPageType
): {
  widthPx: number;
  heightPx: number;
  widthInches: number;
  heightInches: number;
} {
  const pageLayout = getLayoutForPageType(layout, pageType);
  const imageBox = pageLayout.imageBox;

  const widthInches = imageBox?.width ?? layout.leafWidth;
  const heightInches = imageBox?.height ?? layout.leafHeight;

  return {
    widthPx: Math.round(widthInches * PRINT_DPI),
    heightPx: Math.round(heightInches * PRINT_DPI),
    widthInches,
    heightInches,
  };
}

/**
 * Calculate pixel dimensions for image generation based on a print layout's image box.
 * Uses PRINT_DPI (300) to convert inches to pixels.
 * @deprecated Use calculateImageDimensionsForPageType for page-type-aware dimensions
 */
export function calculateImageDimensions(layout: PrintLayout): {
  widthPx: number;
  heightPx: number;
  widthInches: number;
  heightInches: number;
} {
  // Use the first image box dimensions, or fall back to leaf dimensions
  const imageBox = layout.imageBoxes?.[0];
  const widthInches = imageBox?.width ?? layout.leafWidth;
  const heightInches = imageBox?.height ?? layout.leafHeight;

  return {
    widthPx: Math.round(widthInches * PRINT_DPI),
    heightPx: Math.round(heightInches * PRINT_DPI),
    widthInches,
    heightInches,
  };
}

/**
 * Get the aspect ratio string for image generation (e.g., "3:4", "4:3", "1:1")
 * based on the print layout dimensions.
 * @deprecated Use getAspectRatioForPageType for page-type-aware aspect ratios
 */
export function getAspectRatioFromLayout(layout: PrintLayout): string {
  const { widthInches, heightInches } = calculateImageDimensions(layout);

  // Determine orientation
  if (Math.abs(widthInches - heightInches) < 0.1) {
    return '1:1'; // Square
  } else if (heightInches > widthInches) {
    return '3:4'; // Portrait
  } else {
    return '4:3'; // Landscape
  }
}

/**
 * Supported aspect ratios for Gemini 2.5 Flash Image model.
 * The model supports: 21:9, 16:9, 4:3, 3:2, 1:1, 9:16, 3:4, 2:3, 5:4, 4:5
 */
const SUPPORTED_ASPECT_RATIOS = [
  { ratio: '1:1', value: 1 },
  { ratio: '5:4', value: 5 / 4 },      // 1.25
  { ratio: '4:3', value: 4 / 3 },      // 1.33
  { ratio: '3:2', value: 3 / 2 },      // 1.5
  { ratio: '16:9', value: 16 / 9 },    // 1.78
  { ratio: '21:9', value: 21 / 9 },    // 2.33
  { ratio: '4:5', value: 4 / 5 },      // 0.8
  { ratio: '3:4', value: 3 / 4 },      // 0.75
  { ratio: '2:3', value: 2 / 3 },      // 0.67
  { ratio: '9:16', value: 9 / 16 },    // 0.56
];

/**
 * Find the closest supported aspect ratio for a given width/height ratio.
 * Gemini 2.5 Flash Image only supports specific aspect ratios.
 */
function findClosestAspectRatio(widthInches: number, heightInches: number): string {
  const actualRatio = widthInches / heightInches;

  let closest = SUPPORTED_ASPECT_RATIOS[0];
  let minDiff = Math.abs(actualRatio - closest.value);

  for (const ar of SUPPORTED_ASPECT_RATIOS) {
    const diff = Math.abs(actualRatio - ar.value);
    if (diff < minDiff) {
      minDiff = diff;
      closest = ar;
    }
  }

  return closest.ratio;
}

/**
 * Get the aspect ratio string for image generation for a specific page type.
 * Returns a Gemini-compatible aspect ratio string (e.g., "3:4", "4:3", "1:1", "4:5", "16:9").
 */
export function getAspectRatioForPageType(
  layout: PrintLayout,
  pageType: PrintLayoutPageType
): string {
  const { widthInches, heightInches } = calculateImageDimensionsForPageType(layout, pageType);
  return findClosestAspectRatio(widthInches, heightInches);
}

/**
 * Get the effective print layout ID for a child.
 * Returns the child's default if set, otherwise returns the system default.
 */
export function getEffectivePrintLayoutId(childDefaultLayoutId?: string): string {
  return childDefaultLayoutId || DEFAULT_PRINT_LAYOUT_ID;
}
