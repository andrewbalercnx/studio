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

/**
 * `systemConfig/prompts`: the admin-editable global prefix prepended to story
 * prompts when `enabled` (today's `getGlobalPrefix`). Read by the creation
 * engines (slice 5.3); the old loader stays for today's flows until 5.4.
 */
export const globalPromptConfig = defineConfig({
  path: 'systemConfig/prompts',
  schema: z.object({ globalPrefix: z.string(), enabled: z.boolean() }),
  defaults: { globalPrefix: '', enabled: false },
});

/**
 * `systemConfig/compilePrompt`: the admin-editable instructions for polishing
 * an adventure's beats into one story (today's `getCompilePrompt`). Used by
 * the `adventure` engine when `enabled`.
 */
export const compilePromptConfig = defineConfig({
  path: 'systemConfig/compilePrompt',
  schema: z.object({ compilePrompt: z.string(), enabled: z.boolean() }),
  defaults: { compilePrompt: '', enabled: false },
});
