import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Recursively removes undefined values from an object.
 * Firestore doesn't accept undefined values, so this must be called before setDoc/updateDoc.
 *
 * Also converts empty strings to undefined (and thus removes them) for optional fields.
 */
export function removeUndefinedFields<T extends Record<string, any>>(obj: T): Partial<T> {
  const cleaned: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }

    // Recursively clean nested objects (but not arrays or null)
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const cleanedNested = removeUndefinedFields(value);
      // Only include if the nested object has properties
      if (Object.keys(cleanedNested).length > 0) {
        cleaned[key] = cleanedNested;
      }
    } else if (Array.isArray(value)) {
      // For arrays, recursively clean each element if it's an object
      cleaned[key] = value.map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)
          ? removeUndefinedFields(item)
          : item
      );
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned as Partial<T>;
}

/**
 * Parses a Firestore error message to provide a more user-friendly description.
 */
export function parseFirestoreError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Check for undefined field value error
  const undefinedMatch = message.match(/Unsupported field value: undefined \(found in (.+)\)/);
  if (undefinedMatch) {
    return `Cannot save: a required field has no value. Please fill in all required fields and try again.`;
  }

  // Check for permission denied
  if (message.includes('permission-denied') || message.includes('PERMISSION_DENIED')) {
    return 'You do not have permission to perform this action.';
  }

  // Check for not found
  if (message.includes('not-found') || message.includes('NOT_FOUND')) {
    return 'The requested document was not found.';
  }

  // Check for already exists
  if (message.includes('already-exists') || message.includes('ALREADY_EXISTS')) {
    return 'A document with this ID already exists.';
  }

  // Return original message if no pattern matches
  return message;
}
