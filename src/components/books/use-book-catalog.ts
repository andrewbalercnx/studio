'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';

/** A Form as the chooser shows it (`GET /api/storyOutputTypes`: live Forms only). */
export type FormOption = {
  id: string;
  name?: string;
  childFacingLabel?: string;
  shortDescription?: string;
  layoutHints?: { pageCount?: number };
};

/** A Style as the chooser shows it (`GET /api/imageStyles`: preferred first). */
export type StyleOption = {
  id: string;
  title?: string;
  sampleImageUrl?: string | null;
  ageFrom?: number | null;
  ageTo?: number | null;
};

/** Forms and Styles the child can choose from, from the catalogue routes. */
export function useBookCatalog() {
  const [forms, setForms] = useState<FormOption[]>([]);
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [formsResponse, stylesResponse] = await Promise.all([
          authFetch('/api/storyOutputTypes'),
          authFetch('/api/imageStyles'),
        ]);
        const [formsData, stylesData] = await Promise.all([formsResponse.json(), stylesResponse.json()]);
        if (!formsResponse.ok || !stylesResponse.ok) throw new Error('catalogue request failed');
        if (cancelled) return;
        setForms(formsData.outputTypes ?? []);
        setStyles(stylesData.imageStyles ?? []);
      } catch (err) {
        console.error('[useBookCatalog] Failed to load forms and styles', err);
        if (!cancelled) setError("We couldn't load the book choices.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { forms, styles, loading, error };
}

/** Age in whole years from a date of birth (Firestore Timestamp, Date or string). */
export function ageFromDateOfBirth(dob: unknown): number | null {
  if (!dob) return null;
  let date: Date | null = null;
  if (typeof (dob as { toDate?: () => Date }).toDate === 'function') {
    date = (dob as { toDate: () => Date }).toDate();
  } else {
    const parsed = new Date(dob as string);
    date = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (!date) return null;
  const diff = Date.now() - date.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

/** Whether a Style suits a child of this age (unknown age: every Style). */
export function styleSuitsAge(style: StyleOption, age: number | null): boolean {
  if (age === null) return true;
  if (age < (style.ageFrom ?? 0)) return false;
  if (style.ageTo && age > style.ageTo) return false;
  return true;
}
