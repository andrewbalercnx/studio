import type { PrintOrderAddress } from '@/lib/types';

export type AddressValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized?: PrintOrderAddress;
};

/**
 * Validates UK addresses for Mixam submission
 * Currently UK-only, can be expanded for international later
 */
export function validateUKAddress(address: PrintOrderAddress): AddressValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Required fields check
  if (!address.name?.trim()) {
    errors.push('Recipient name is required');
  }

  if (!address.line1?.trim()) {
    errors.push('Address line 1 is required');
  }

  if (!address.city?.trim()) {
    errors.push('City/town is required');
  }

  if (!address.postalCode?.trim()) {
    errors.push('Postcode is required');
  }

  if (!address.country?.trim()) {
    errors.push('Country is required');
  }

  // 2. Country validation (UK only for now)
  const normalizedCountry = address.country?.trim().toUpperCase();
  const ukCountries = ['GB', 'UK', 'UNITED KINGDOM', 'GREAT BRITAIN', 'ENGLAND', 'SCOTLAND', 'WALES', 'NORTHERN IRELAND'];

  if (normalizedCountry && !ukCountries.includes(normalizedCountry)) {
    errors.push('Currently only UK addresses are supported');
  }

  // 3. UK Postcode validation
  if (address.postalCode) {
    const postcodeResult = validateUKPostcode(address.postalCode);
    if (!postcodeResult.valid) {
      errors.push(...postcodeResult.errors);
    }
  }

  // 4. Field length validation
  if (address.name && address.name.length > 100) {
    errors.push('Recipient name is too long (max 100 characters)');
  }

  if (address.line1 && address.line1.length > 100) {
    errors.push('Address line 1 is too long (max 100 characters)');
  }

  if (address.line2 && address.line2.length > 100) {
    errors.push('Address line 2 is too long (max 100 characters)');
  }

  if (address.city && address.city.length > 50) {
    errors.push('City name is too long (max 50 characters)');
  }

  // 5. Warnings for common issues
  if (address.line1 && !address.line2 && address.line1.length < 10) {
    warnings.push('Address seems unusually short - please verify it is complete');
  }

  if (!address.state || address.state.trim() === '') {
    warnings.push('County/region not provided (optional but recommended)');
  }

  // 6. Normalize the address
  const normalized: PrintOrderAddress = {
    name: address.name?.trim() || '',
    line1: address.line1?.trim() || '',
    line2: address.line2?.trim() || undefined,
    city: address.city?.trim() || '',
    state: address.state?.trim() || '',
    postalCode: normalizeUKPostcode(address.postalCode || ''),
    country: 'GB', // Standardize to ISO code
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: errors.length === 0 ? normalized : undefined,
  };
}

/**
 * Validates UK postcode format
 * Supports various UK postcode formats
 */
function validateUKPostcode(postcode: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!postcode || !postcode.trim()) {
    errors.push('Postcode is required');
    return { valid: false, errors };
  }

  // Remove spaces and convert to uppercase for validation
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase();

  // UK Postcode regex patterns
  // Supports: A9 9AA, A99 9AA, A9A 9AA, AA9 9AA, AA99 9AA, AA9A 9AA
  const postcodePatterns = [
    /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/,  // Standard UK postcode
    /^GIR\s?0AA$/,                            // Special case: Girobank
    /^[A-Z]{2}\d{2}$/,                        // BFPO (British Forces)
  ];

  const isValid = postcodePatterns.some(pattern => pattern.test(cleaned));

  if (!isValid) {
    errors.push('Invalid UK postcode format (e.g., SW1A 1AA)');
  }

  // Length check
  if (cleaned.length < 5 || cleaned.length > 7) {
    errors.push('UK postcode must be 5-7 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Normalizes UK postcode to standard format
 * E.g., "sw1a1aa" -> "SW1A 1AA"
 */
function normalizeUKPostcode(postcode: string): string {
  if (!postcode) return '';

  // Remove all spaces and convert to uppercase
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase();

  // Special case: Girobank
  if (cleaned === 'GIR0AA') {
    return 'GIR 0AA';
  }

  // BFPO postcodes don't have spaces
  if (cleaned.startsWith('BFPO')) {
    return cleaned;
  }

  // Standard UK postcode: add space before last 3 characters
  if (cleaned.length >= 5 && cleaned.length <= 7) {
    const outward = cleaned.slice(0, -3);
    const inward = cleaned.slice(-3);
    return `${outward} ${inward}`;
  }

  // Return as-is if we can't normalize
  return postcode.toUpperCase();
}

/**
 * Checks if an address looks like a PO Box
 * Mixam may have restrictions on PO Box delivery
 */
export function isPOBox(address: PrintOrderAddress): boolean {
  const poBoxPatterns = [
    /\bP\.?O\.?\s*BOX\b/i,
    /\bPOST\s*OFFICE\s*BOX\b/i,
    /\bPO\s*BOX\b/i,
  ];

  const fullAddress = `${address.line1} ${address.line2 || ''}`.toUpperCase();
  return poBoxPatterns.some(pattern => pattern.test(fullAddress));
}

/**
 * Extracts town/city from postcode (first part)
 * Useful for address verification
 */
export function getPostcodeTown(postcode: string): string {
  const normalized = normalizeUKPostcode(postcode);
  const outward = normalized.split(' ')[0];
  return outward.replace(/\d+[A-Z]?$/, ''); // Remove digits and optional letter
}
