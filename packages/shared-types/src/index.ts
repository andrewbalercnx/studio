/**
 * @storypic/shared-types
 *
 * The API's request and response shapes, shared by every client (web, kids
 * PWA, mobile) through `@storypic/api-client` (Phase 6.1). Hand-written to
 * match the server's views; generating them from the zod schemas is Phase 7.
 */

/** Pronouns for children and characters - used in story generation */
export type Pronouns = 'he/him' | 'she/her' | 'they/them';

export * from './catalog';
export * from './stories';
export * from './books';
export * from './orders';
export * from './people';
export * from './library';
export * from './tts';
