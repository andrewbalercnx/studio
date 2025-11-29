
import type { ChildProfile } from '@/lib/types';

export function summarizeChildPreferences(child: ChildProfile | null | undefined): string {
  if (!child) return 'No extra preferences provided.';
  const prefs = child.preferences;
  const parts: string[] = [];
  if (prefs?.favoriteColors?.length) {
    parts.push(`Favorite colors: ${prefs.favoriteColors.join(', ')}`);
  }
  if (prefs?.favoriteFoods?.length) {
    parts.push(`Favorite foods: ${prefs.favoriteFoods.join(', ')}`);
  }
  if (prefs?.favoriteGames?.length) {
    parts.push(`Favorite games: ${prefs.favoriteGames.join(', ')}`);
  }
  if (prefs?.favoriteSubjects?.length) {
    parts.push(`Favorite school subjects: ${prefs.favoriteSubjects.join(', ')}`);
  }
  if (child.photos?.length) {
    parts.push(
      `Reference photos provided: ${child.photos.length}. Use them only for inspiration; never mention the photos directly.`
    );
  }
  return parts.length > 0 ? parts.join('\n') : 'No extra preferences provided.';
}
