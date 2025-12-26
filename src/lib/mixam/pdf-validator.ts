import type { MixamValidationResult, PrintableAssetMetadata, PrintProduct } from '@/lib/types';

/**
 * Validates a printable PDF for Mixam compatibility
 * Performs local checks without calling Mixam API
 */
export async function validatePrintablePDF(params: {
  coverPdfUrl: string;
  interiorPdfUrl: string;
  metadata: PrintableAssetMetadata;
  product: PrintProduct;
}): Promise<MixamValidationResult> {
  const { coverPdfUrl, interiorPdfUrl, metadata, product } = params;
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. Check that PDFs are accessible
    const [coverResponse, interiorResponse] = await Promise.all([
      fetch(coverPdfUrl, { method: 'HEAD' }).catch(() => null),
      fetch(interiorPdfUrl, { method: 'HEAD' }).catch(() => null),
    ]);

    if (!coverResponse || !coverResponse.ok) {
      errors.push('Cover PDF is not accessible');
    }
    if (!interiorResponse || !interiorResponse.ok) {
      errors.push('Interior PDF is not accessible');
    }

    // 2. Check file sizes
    const coverSize = coverResponse?.headers.get('content-length');
    const interiorSize = interiorResponse?.headers.get('content-length');

    if (coverSize) {
      const sizeBytes = parseInt(coverSize, 10);
      if (sizeBytes > product.mixamSpec.files.maxFileSize) {
        errors.push(`Cover PDF exceeds max file size (${(product.mixamSpec.files.maxFileSize / 1024 / 1024 / 1024).toFixed(1)}GB)`);
      }
      if (sizeBytes < 1000) {
        warnings.push('Cover PDF seems unusually small');
      }
    }

    if (interiorSize) {
      const sizeBytes = parseInt(interiorSize, 10);
      if (sizeBytes > product.mixamSpec.files.maxFileSize) {
        errors.push(`Interior PDF exceeds max file size (${(product.mixamSpec.files.maxFileSize / 1024 / 1024 / 1024).toFixed(1)}GB)`);
      }
      if (sizeBytes < 1000) {
        warnings.push('Interior PDF seems unusually small');
      }
    }

    // 3. Validate page counts
    // For hardcover (case-bound) books, cover PDF should be 2 pages (front + back outside)
    // The inside covers are end papers and are a separate component
    // For paperback, cover PDF should be 4 pages (front outside, front inside, back inside, back outside)
    const bindingType = product.mixamSpec?.binding?.type || 'case';
    const isHardcover = bindingType === 'case' || bindingType === 'case_with_sewing';
    const expectedCoverPages = isHardcover ? 2 : 4;

    if (metadata.coverPageCount !== expectedCoverPages) {
      errors.push(`Cover must have exactly ${expectedCoverPages} pages for ${isHardcover ? 'hardcover' : 'paperback'} books, got ${metadata.coverPageCount}`);
    }

    // Calculate minimum interior pages
    // Note: For hardcover (case) binding, Mixam requires minimum 24 interior pages
    // regardless of what the product spec says, due to spine thickness requirements
    const hardcoverMinInterior = 24;

    const configuredMinPages = product.mixamSpec.format.minPageCount - 4; // Subtract cover pages
    const minPages = isHardcover ? Math.max(configuredMinPages, hardcoverMinInterior) : configuredMinPages;
    const maxPages = product.mixamSpec.format.maxPageCount - 4;

    if (metadata.interiorPageCount < minPages) {
      const bindingNote = isHardcover ? ' (hardcover books require at least 24 interior pages for spine thickness)' : '';
      errors.push(`Interior page count ${metadata.interiorPageCount} is below minimum ${minPages}${bindingNote}`);
    }

    if (metadata.interiorPageCount > maxPages) {
      errors.push(`Interior page count ${metadata.interiorPageCount} exceeds maximum ${maxPages}`);
    }

    // 4. Check page count divisibility
    const increment = product.mixamSpec.format.pageCountIncrement;
    if (metadata.interiorPageCount % increment !== 0) {
      errors.push(`Interior page count ${metadata.interiorPageCount} must be divisible by ${increment}`);
    }

    // 5. Validate DPI
    if (metadata.dpi < product.mixamSpec.files.minDPI) {
      errors.push(`DPI ${metadata.dpi} is below minimum ${product.mixamSpec.files.minDPI}`);
    } else if (metadata.dpi < 300) {
      warnings.push('DPI below recommended 300 - print quality may be affected');
    }

    // 6. Validate trim size
    const trimSizeParts = metadata.trimSize.split('x').map(s => s.trim());
    const widthStr = trimSizeParts[0];
    const heightStr = trimSizeParts[1];

    const widthInches = parseFloat(widthStr);
    const heightInches = parseFloat(heightStr);

    if (isNaN(widthInches) || isNaN(heightInches)) {
      errors.push(`Invalid trim size format: ${metadata.trimSize}`);
    } else {
      // Convert to mm
      const widthMm = widthInches * 25.4;
      const heightMm = heightInches * 25.4;

      // Check if this trim size is allowed
      const allowedSize = product.mixamSpec.format.allowedTrimSizes.find(
        size => Math.abs(size.width - widthMm) < 1 && Math.abs(size.height - heightMm) < 1
      );

      if (!allowedSize) {
        errors.push(`Trim size ${metadata.trimSize} is not supported for this product`);
      }
    }

    // 7. Check for bleed
    const bleedRequired = product.mixamSpec.format.bleedRequired;
    if (bleedRequired > 0) {
      warnings.push(`Ensure PDF includes ${bleedRequired}mm (${(bleedRequired / 25.4).toFixed(3)}") bleed on all sides`);
    }

    // 8. Color space check (warning only - can't validate without parsing PDF)
    if (product.mixamSpec.files.colorSpace === 'CMYK') {
      warnings.push('Ensure PDFs use CMYK color space for print (not RGB)');
    }

    // Build result
    const result: MixamValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
      checkedAt: Date.now(),
      fileInfo: {
        pageCount: metadata.pageCount,
        coverPageCount: metadata.coverPageCount,
        interiorPageCount: metadata.interiorPageCount,
        fileSize: (coverSize && interiorSize)
          ? parseInt(coverSize, 10) + parseInt(interiorSize, 10)
          : 0,
      },
    };

    return result;

  } catch (error: any) {
    return {
      valid: false,
      errors: [`Validation failed: ${error.message}`],
      warnings: [],
      checkedAt: Date.now(),
    };
  }
}

/**
 * Quick validation check (subset of full validation)
 * Used for pre-checks before full validation
 */
export function quickValidateMetadata(
  metadata: PrintableAssetMetadata,
  product: PrintProduct
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check binding type
  const bindingType = product.mixamSpec?.binding?.type || 'case';
  const isHardcover = bindingType === 'case' || bindingType === 'case_with_sewing';

  // Page count checks - cover pages differ by binding type
  const expectedCoverPages = isHardcover ? 2 : 4;
  if (metadata.coverPageCount !== expectedCoverPages) {
    errors.push(`Cover must have ${expectedCoverPages} pages for ${isHardcover ? 'hardcover' : 'paperback'}`);
  }

  // For hardcover, enforce 24 interior pages minimum
  const hardcoverMinInterior = 24;
  if (isHardcover && metadata.interiorPageCount < hardcoverMinInterior) {
    errors.push(`Hardcover books require at least ${hardcoverMinInterior} interior pages (got ${metadata.interiorPageCount})`);
  }

  const totalMinPages = product.mixamSpec.format.minPageCount;
  const totalMaxPages = product.mixamSpec.format.maxPageCount;

  if (metadata.pageCount < totalMinPages) {
    errors.push(`Total pages ${metadata.pageCount} below minimum ${totalMinPages}`);
  }

  if (metadata.pageCount > totalMaxPages) {
    errors.push(`Total pages ${metadata.pageCount} exceeds maximum ${totalMaxPages}`);
  }

  // Divisibility check
  const increment = product.mixamSpec.format.pageCountIncrement;
  if (metadata.interiorPageCount % increment !== 0) {
    errors.push(`Interior pages must be divisible by ${increment}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
