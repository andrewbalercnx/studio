import { NextRequest, NextResponse } from 'next/server';
import { requireParentOrAdminUser } from '@/lib/server-auth';
import { mixamClient } from '@/lib/mixam/client';
import type { MixamProductMapping } from '@/lib/types';

type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * POST /api/admin/print-products/validate-mixam
 * Validates a MixamProductMapping against the Mixam catalogue
 *
 * Request body: MixamProductMapping
 * Response: { ok: boolean, validation: ValidationResult }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireParentOrAdminUser(request);

    if (!user.claims.isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const mapping: MixamProductMapping = await request.json();

    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (typeof mapping.productId !== 'number') {
      errors.push('productId is required and must be a number');
    }
    if (typeof mapping.subProductId !== 'number') {
      errors.push('subProductId is required and must be a number');
    }

    // Validate bound component
    if (!mapping.boundComponent) {
      errors.push('boundComponent is required');
    } else {
      if (typeof mapping.boundComponent.format !== 'number') {
        errors.push('boundComponent.format is required');
      }
      if (!mapping.boundComponent.substrate) {
        errors.push('boundComponent.substrate is required');
      } else {
        if (typeof mapping.boundComponent.substrate.typeId !== 'number') {
          errors.push('boundComponent.substrate.typeId is required');
        }
        if (typeof mapping.boundComponent.substrate.weightId !== 'number') {
          errors.push('boundComponent.substrate.weightId is required');
        }
      }
    }

    // Validate cover component
    if (!mapping.coverComponent) {
      errors.push('coverComponent is required');
    } else {
      if (typeof mapping.coverComponent.format !== 'number') {
        errors.push('coverComponent.format is required');
      }
      if (!mapping.coverComponent.substrate) {
        errors.push('coverComponent.substrate is required');
      }
      if (!['NONE', 'GLOSS', 'MATT', 'SOFT_TOUCH'].includes(mapping.coverComponent.lamination)) {
        errors.push('coverComponent.lamination must be NONE, GLOSS, MATT, or SOFT_TOUCH');
      }
    }

    // Validate binding
    if (!mapping.binding) {
      errors.push('binding is required');
    } else {
      if (!['PUR', 'CASE', 'STAPLED', 'LOOP', 'WIRO'].includes(mapping.binding.type)) {
        errors.push('binding.type must be PUR, CASE, STAPLED, LOOP, or WIRO');
      }
      if (!['LEFT_RIGHT', 'TOP_BOTTOM'].includes(mapping.binding.edge)) {
        errors.push('binding.edge must be LEFT_RIGHT or TOP_BOTTOM');
      }
    }

    // If there are structural errors, return early
    if (errors.length > 0) {
      return NextResponse.json({
        ok: true,
        validation: { valid: false, errors, warnings },
      });
    }

    // Validate against Mixam catalogue - this is critical for catching invalid combinations
    try {
      console.log(`[validate-mixam] Fetching metadata for product ${mapping.productId}/${mapping.subProductId}`);
      const metadata = await mixamClient.getProductMetadata(
        mapping.productId,
        mapping.subProductId
      );

      // Check if product exists
      if (!metadata || (!metadata.raw && !metadata.formats)) {
        errors.push('Could not fetch product metadata from Mixam catalogue. Cannot validate.');
      } else {
        console.log('[validate-mixam] Catalogue metadata fetched successfully');

        // Check format is valid
        if (metadata.formats && metadata.formats.length > 0) {
          const formatIds = metadata.formats.map((f: any) => f.id);
          if (!formatIds.includes(mapping.boundComponent.format)) {
            errors.push(`Format ${mapping.boundComponent.format} is not available for this product. Valid formats: ${formatIds.join(', ')}`);
          }
        }

        // Validate substrates with weight combinations
        // Try to find substrates in various locations in the response
        let substrates = metadata.substrates;
        if ((!substrates || substrates.length === 0) && metadata.raw) {
          // Try alternative locations in raw response
          substrates = metadata.raw.substrates ||
            metadata.raw.papers ||
            metadata.raw.boundComponentMetadata?.substratesMetadata ||
            metadata.raw.coverComponentMetadata?.substratesMetadata ||
            [];

          // If substrates is an object (keyed by typeId), convert to array
          if (substrates && typeof substrates === 'object' && !Array.isArray(substrates)) {
            substrates = Object.entries(substrates).map(([key, value]: [string, any]) => ({
              typeId: parseInt(key, 10),
              typeName: value.name || value.typeName || `Type ${key}`,
              weights: value.weights || [],
              ...value,
            }));
          }
        }

        console.log(`[validate-mixam] Found ${substrates?.length || 0} substrate types`);

        if (substrates && substrates.length > 0) {
          // Validate bound component substrate
          const boundSubstrate = substrates.find(
            (s: any) => (s.typeId ?? s.id) === mapping.boundComponent.substrate.typeId
          );

          if (!boundSubstrate) {
            const validTypes = substrates.map((s: any) => `${s.typeId ?? s.id} (${s.typeName ?? s.name})`);
            errors.push(`Bound component substrate type ${mapping.boundComponent.substrate.typeId} is not available. Valid types: ${validTypes.join(', ')}`);
          } else {
            // Check if weight ID is valid for this substrate type
            if (boundSubstrate.weights && boundSubstrate.weights.length > 0) {
              const validWeightIds = boundSubstrate.weights.map((w: any) => w.id);
              if (!validWeightIds.includes(mapping.boundComponent.substrate.weightId)) {
                const validWeights = boundSubstrate.weights.map((w: any) => `${w.id} (${w.weight} ${w.unit || 'GSM'})`);
                errors.push(`Bound component weight ID ${mapping.boundComponent.substrate.weightId} is not valid for substrate type ${mapping.boundComponent.substrate.typeId}. Valid weight IDs: ${validWeights.join(', ')}`);
              }
            } else {
              warnings.push(`Could not validate bound component weight - no weight data for substrate type ${mapping.boundComponent.substrate.typeId}`);
            }
          }

          // Validate cover component substrate
          const coverSubstrate = substrates.find(
            (s: any) => (s.typeId ?? s.id) === mapping.coverComponent.substrate.typeId
          );

          if (!coverSubstrate) {
            const validTypes = substrates.map((s: any) => `${s.typeId ?? s.id} (${s.typeName ?? s.name})`);
            errors.push(`Cover component substrate type ${mapping.coverComponent.substrate.typeId} is not available. Valid types: ${validTypes.join(', ')}`);
          } else {
            // Check if weight ID is valid for this substrate type
            if (coverSubstrate.weights && coverSubstrate.weights.length > 0) {
              const validWeightIds = coverSubstrate.weights.map((w: any) => w.id);
              if (!validWeightIds.includes(mapping.coverComponent.substrate.weightId)) {
                const validWeights = coverSubstrate.weights.map((w: any) => `${w.id} (${w.weight} ${w.unit || 'GSM'})`);
                errors.push(`Cover component weight ID ${mapping.coverComponent.substrate.weightId} is not valid for substrate type ${mapping.coverComponent.substrate.typeId}. Valid weight IDs: ${validWeights.join(', ')}`);
              }
            } else {
              warnings.push(`Could not validate cover component weight - no weight data for substrate type ${mapping.coverComponent.substrate.typeId}`);
            }
          }
        } else {
          // Log the raw response to help debug
          console.log('[validate-mixam] Raw metadata keys:', metadata.raw ? Object.keys(metadata.raw) : 'no raw data');

          // Fall back to known-good weight IDs for hardcover books based on Mixam documentation
          // These are the typical valid weight IDs for silk/gloss substrates in book products
          const KNOWN_VALID_WEIGHT_IDS = [0, 2, 3, 4, 5]; // 90, 115, 130, 150, 170 GSM
          const INVALID_WEIGHT_IDS = [14]; // 200 GSM is NOT available for book products

          if (INVALID_WEIGHT_IDS.includes(mapping.boundComponent.substrate.weightId)) {
            errors.push(`Bound component weight ID ${mapping.boundComponent.substrate.weightId} is known to be invalid for book products. Use one of: ${KNOWN_VALID_WEIGHT_IDS.join(', ')} (recommended: 5 for 170 GSM)`);
          }

          if (INVALID_WEIGHT_IDS.includes(mapping.coverComponent.substrate.weightId)) {
            errors.push(`Cover component weight ID ${mapping.coverComponent.substrate.weightId} is known to be invalid for book products. Use one of: ${KNOWN_VALID_WEIGHT_IDS.join(', ')} (recommended: 5 for 170 GSM)`);
          }

          if (errors.length === 0) {
            warnings.push('Could not fully validate substrate combinations against catalogue. Using known-good defaults validation instead.');
          }
        }

        // Check binding type
        if (metadata.bindings && metadata.bindings.length > 0) {
          const bindingTypes = metadata.bindings.map((b: any) => b.type);
          if (!bindingTypes.includes(mapping.binding.type)) {
            errors.push(`Binding type ${mapping.binding.type} is not available. Valid types: ${bindingTypes.join(', ')}`);
          }
        }

        // Check lamination
        if (metadata.laminations && metadata.laminations.length > 0) {
          const laminationTypes = metadata.laminations.map((l: any) => l.type);
          if (!laminationTypes.includes(mapping.coverComponent.lamination)) {
            errors.push(`Lamination type ${mapping.coverComponent.lamination} is not available. Valid types: ${laminationTypes.join(', ')}`);
          }
        }
      }
    } catch (catalogueError: any) {
      // Catalogue validation failed - this is now an error, not a warning
      console.error('[validate-mixam] Could not validate against catalogue:', catalogueError.message);
      errors.push(`Could not validate against Mixam catalogue: ${catalogueError.message}. Please ensure Mixam API is accessible.`);
    }

    // Add hardcover-specific validations
    if (mapping.binding.type === 'CASE') {
      if (!mapping.endPapersComponent) {
        errors.push('End papers component is required for case-bound (hardcover) books');
      }
      if (mapping.coverComponent.backColours !== 'NONE') {
        errors.push('Hardcover books must have backColours: NONE (inner side is glued to board)');
      }
    }

    const validation: ValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    return NextResponse.json({ ok: true, validation });

  } catch (error: any) {
    console.error('[validate-mixam] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
