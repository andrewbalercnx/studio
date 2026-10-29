/**
 * Repositories for the target entities (docs/architecture/target/domain-model.md).
 *
 * These collections do not exist yet; Phase 5 slices start writing them. Child
 * and Character repositories (which embed `likenessSchema`) are added by the
 * Characters slice, together with the rest of their fields.
 */
import { defineRepository, defineSubRepository } from './repository';
import { bookPageSchema, bookSchema, castSheetSchema, renderSchema } from './schemas/book';
import { jobSchema } from './schemas/job';
import { manuscriptPageSchema, manuscriptSchema } from './schemas/manuscript';
import { storySchema } from './schemas/story';

export const jobs = defineRepository({ path: 'jobs', schema: jobSchema, label: 'Job' });

export const stories = defineRepository({ path: 'stories', schema: storySchema, label: 'Story' });

export const manuscripts = defineRepository({ path: 'manuscripts', schema: manuscriptSchema, label: 'Manuscript' });
export const manuscriptPages = defineSubRepository({
  parent: 'manuscripts',
  name: 'pages',
  schema: manuscriptPageSchema,
  label: 'Manuscript page',
});

export const books = defineRepository({ path: 'books', schema: bookSchema, label: 'Book' });
export const bookPages = defineSubRepository({ parent: 'books', name: 'pages', schema: bookPageSchema, label: 'Book page' });
export const castSheets = defineSubRepository({
  parent: 'books',
  name: 'castSheets',
  schema: castSheetSchema,
  label: 'Cast sheet',
});
export const renders = defineSubRepository({
  parent: 'books',
  name: 'renders',
  schema: renderSchema,
  label: 'Render',
  immutable: true,
});
