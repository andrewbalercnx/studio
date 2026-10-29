/**
 * Config documents read by the new server foundations. Each slice adds its own
 * definitions here as it moves a `*-config.server.ts` loader onto the service.
 */
import { z } from 'zod';
import { DEFAULT_DIAGNOSTICS_CONFIG, DEFAULT_PAGINATION_PROMPT } from '@/lib/types';
import { defineConfig } from './config-service';

/**
 * `systemConfig/diagnostics`: today's logging toggles (Admin → Diagnostics &
 * Logging). Only the fields the foundations read are modelled; the document
 * keeps its other fields.
 */
export const diagnosticsConfig = defineConfig({
  path: 'systemConfig/diagnostics',
  schema: z.object({
    enableAIFlowLogging: z.boolean(),
    enableServerLogging: z.boolean(),
  }),
  defaults: {
    enableAIFlowLogging: DEFAULT_DIAGNOSTICS_CONFIG.enableAIFlowLogging,
    enableServerLogging: DEFAULT_DIAGNOSTICS_CONFIG.enableServerLogging,
  },
});

/**
 * `systemConfig/paginationPrompt`: the admin-editable general pagination
 * instructions. Read by `manuscript.paginate`; the admin route invalidates it on save.
 */
export const paginationPromptConfig = defineConfig({
  path: 'systemConfig/paginationPrompt',
  schema: z.object({ paginationPrompt: z.string(), enabled: z.boolean() }),
  defaults: { paginationPrompt: DEFAULT_PAGINATION_PROMPT, enabled: true },
});

/**
 * `systemConfig/imagePrompt`: an optional global prefix for every page image.
 * Used by `book.pageArt` only when `enabled`; the admin route invalidates it on save.
 */
export const imagePromptConfig = defineConfig({
  path: 'systemConfig/imagePrompt',
  schema: z.object({ imagePrompt: z.string(), enabled: z.boolean() }),
  defaults: { imagePrompt: '', enabled: false },
});
