/**
 * Config documents read by the new server foundations. Each slice adds its own
 * definitions here as it moves a `*-config.server.ts` loader onto the service.
 */
import { z } from 'zod';
import { DEFAULT_DIAGNOSTICS_CONFIG } from '@/lib/types';
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
