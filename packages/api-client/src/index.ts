/**
 * @storypic/api-client
 *
 * Typed API client for StoryPic Kids child-facing features.
 * Used by PWA and mobile clients.
 *
 * NOTE: This client only exposes child-safe operations.
 * Parent management, print ordering, and admin functions are excluded.
 */

export { StoryPicClient, type StoryPicClientConfig } from './client.js';

// Re-export all types from shared-types for convenience
export * from '@storypic/shared-types';
