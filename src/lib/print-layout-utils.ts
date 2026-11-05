import type { PrintLayout, PageLayoutConfig, PrintLayoutPageType } from './types';

/**
 * Get the layout configuration for a specific page type (cover, inside, backCover, titlePage).
 * Falls back to legacy textBoxes/imageBoxes arrays if page-specific layouts are not defined.
 * Respects textBoxEnabled and imageBoxEnabled flags - returns undefined for disabled boxes.
 */
export function getLayoutForPageType(
  layout: PrintLayout,
  pageType: PrintLayoutPageType
): PageLayoutConfig {
  let rawConfig: PageLayoutConfig | undefined;

  // Try page-specific layouts first
  switch (pageType) {
    case 'cover':
      rawConfig = layout.coverLayout;
      break;
    case 'backCover':
      rawConfig = layout.backCoverLayout;
      break;
    case 'titlePage':
      // Title page: use titlePageLayout if defined, otherwise return full-page text box (no image)
      if (layout.titlePageLayout) {
        rawConfig = layout.titlePageLayout;
      } else {
        // Default: full-page text box centered, no image
        return {
          textBoxEnabled: true,
          imageBoxEnabled: false,
          textBox: {
            x: 0.5,
            y: 0.5,
            width: layout.leafWidth - 1,
            height: layout.leafHeight - 1,
          },
        };
      }
      break;
    case 'inside':
      rawConfig = layout.insideLayout;
      break;
  }

  // If we have a page-specific config, apply enabled flags
  if (rawConfig) {
    return {
      textBoxEnabled: rawConfig.textBoxEnabled,
      imageBoxEnabled: rawConfig.imageBoxEnabled,
      // Only include textBox if enabled (default true when undefined)
      textBox: rawConfig.textBoxEnabled !== false ? rawConfig.textBox : undefined,
      // Only include imageBox if enabled (default true when undefined)
      imageBox: rawConfig.imageBoxEnabled !== false ? rawConfig.imageBox : undefined,
    };
  }

  // Fallback to legacy arrays (used for inside pages or if no specific layout defined)
  return {
    textBoxEnabled: true,
    imageBoxEnabled: true,
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
