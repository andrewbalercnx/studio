import { describe, expect, it } from 'vitest';
import { formFromDocument, resolveManuscriptShape } from '../forms';
import { artAspectRatio, layoutFromDocuments, layoutSupports, physicalPageCount } from '../layouts';
import { styleFromDocument, styleReferencesFor } from '../styles';

describe('Form from storyOutputTypes', () => {
  it('gives picture books the 12/16/24 menu, defaulting from layoutHints', () => {
    const form = formFromDocument('pb', {
      name: 'Picture book',
      status: 'live',
      category: 'picture_book',
      ageRange: '3-6',
      layoutHints: { pageCount: 14, textDensity: 'very_low' },
      aiHints: { style: 'gentle', allowRhyme: true },
      paginationPrompt: '  Bounce.  ',
    })!;
    expect(form).toMatchObject({
      allowedLengths: [12, 16, 24],
      defaultLength: 12,
      defaultDensity: 'picture-led',
      readingLevel: '3-6',
      paginationPrompt: 'Bounce.',
      styleHint: 'gentle',
      rhymes: true,
    });
  });

  it('gives other categories a single length', () => {
    expect(formFromDocument('poem', { category: 'poem', layoutHints: { pageCount: 6 } })).toMatchObject({ allowedLengths: [6], defaultLength: 6 });
    expect(formFromDocument('colour', { category: 'coloring_pages' })).toMatchObject({ allowedLengths: [12], defaultLength: 12, defaultDensity: 'balanced' });
  });

  it('prefers target-shape fields when present', () => {
    const form = formFromDocument('f', { category: 'picture_book', allowedLengths: [24, 16], defaultLength: 24, densities: ['text-led'], defaultDensity: 'text-led' })!;
    expect(form).toMatchObject({ allowedLengths: [16, 24], defaultLength: 24, densities: ['text-led'], defaultDensity: 'text-led' });
    expect(resolveManuscriptShape(form, {})).toEqual({ ok: true, shape: { length: 24, density: 'text-led' } });
    expect(resolveManuscriptShape(form, { density: 'balanced' })).toMatchObject({ ok: false, field: 'density' });
    expect(resolveManuscriptShape(form, { length: 12 })).toMatchObject({ ok: false, field: 'length' });
  });
});

describe('Style from imageStyles', () => {
  it('keeps only ready scene references and orders references like today', () => {
    const style = styleFromDocument('w', {
      title: 'Water',
      stylePrompt: 'soft',
      exampleImages: [{ url: 'a' }, { url: 'b' }],
      sampleImageUrl: 's',
      sceneExemplars: { 'indoor-day': { imageUrl: 'i', status: 'ready' }, 'outdoor-day': { imageUrl: 'o', status: 'generating' } },
    })!;
    expect(styleReferencesFor(style, 'indoor-day')).toEqual(['i']);
    expect(styleReferencesFor(style, 'outdoor-day')).toEqual(['a', 'b']);
    expect(styleReferencesFor({ ...style, exampleImages: [] }, null)).toEqual(['s']);
    expect(styleFromDocument('x', { title: 'No prompt' })).toBeNull();
  });
});

describe('Layout from printLayouts', () => {
  it('pads to the page rules (ADR-0011: 12 and 16 → 24, 24 → 28)', () => {
    const rules = { minPages: 24, maxPages: 0, pageMultiple: 4 as const };
    expect([12, 16, 24].map((n) => physicalPageCount(n, rules))).toEqual([24, 24, 28]);
  });

  it('supports a length only when the padded book fits', () => {
    const layout = layoutFromDocuments('l', { name: 'L', leafWidth: 10, leafHeight: 8, pageConstraints: { maxPages: 24, pageMultiple: 4 } });
    expect(layoutSupports(layout, 16, 'balanced')).toEqual({ ok: true });
    expect(layoutSupports(layout, 24, 'balanced')).toMatchObject({ ok: false });
    expect(layoutSupports({ ...layout, supportedDensities: ['picture-led'] }, 16, 'balanced')).toMatchObject({ ok: false });
    expect(artAspectRatio(layout)).toBe('5:4');
    expect(artAspectRatio(null)).toBe('1:1');
  });
});
