
import type { ChildProfile } from '@/lib/types';

function calculateAge(dob: any): number | null {
  if (!dob) return null;

  let date: Date | null = null;
  if (typeof dob?.toDate === 'function') {
    date = dob.toDate();
  } else {
    const parsed = new Date(dob);
    date = isNaN(parsed.getTime()) ? null : parsed;
  }

  if (!date) return null;
  const diff = Date.now() - date.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

export function summarizeChildPreferences(child: ChildProfile | null | undefined): string {
  if (!child) return 'No preferences provided.';

  const parts: string[] = [];

  // Date of birth / Age
  if (child.dateOfBirth) {
    const age = calculateAge(child.dateOfBirth);
    if (age !== null) {
      parts.push(`Age: ${age} years old`);
    }
  }

  // Pronouns
  if (child.pronouns) {
    parts.push(`Pronouns: ${child.pronouns}`);
  } else {
    parts.push(`Pronouns: they/them (default)`);
  }

  // Likes
  if (child.likes?.length) {
    parts.push(`Likes: ${child.likes.join(', ')}`);
  }

  // Dislikes
  if (child.dislikes?.length) {
    parts.push(`Dislikes: ${child.dislikes.join(', ')}`);
  }

  // Description
  if (child.description) {
    parts.push(`Description: ${child.description}`);
  }

  // Photos (for avatar generation context)
  if (child.photos?.length) {
    parts.push(
      `Reference photos provided: ${child.photos.length}. Use them only for inspiration; never mention the photos directly.`
    );
  }

  return parts.length > 0 ? parts.join('\n') : 'No preferences provided.';
}
