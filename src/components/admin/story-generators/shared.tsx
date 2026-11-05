'use client';
import type { AIModelName } from '@/lib/types';
import { Select } from '@/components/ui/select';

export const PROMPT_DESCRIPTIONS: Record<string, Record<string, string>> = {
  wizard: {
    questionGeneration: 'Prompt for generating multiple-choice questions during the wizard flow',
    storyGeneration: 'Prompt for generating the final story based on the child\'s answers',
  },
  gemini3: {
    systemPrompt: 'Main system prompt for the open-ended creative story generation',
  },
  gemini4: {
    systemPrompt: 'Main system prompt for the guided story creation with phases',
    phase_opening: 'Opening question phase guidance',
    phase_setting: 'Setting question phase guidance',
    phase_characters: 'Character introduction phase guidance',
    phase_conflict: 'Problem/conflict phase guidance',
    phase_action: 'Action phase guidance',
    phase_resolution: 'Resolution phase guidance',
    phase_development: 'Development phase guidance (used for extra questions)',
  },
  friends: {
    characterProposal: 'Prompt for AI to propose initial character selection for the adventure',
    scenarioGeneration: 'Prompt for generating adventure scenario options',
    synopsisGeneration: 'Prompt for drafting story synopses based on chosen scenario',
    storyGeneration: 'Prompt for generating the final complete story',
  },
};

// Default fallback info (used if generator data is missing)
export const DEFAULT_GENERATOR_INFO: Record<string, { name: string; description: string }> = {
  wizard: {
    name: 'Story Wizard',
    description: 'A 4-question wizard that gathers story preferences before generating a complete story',
  },
  gemini3: {
    name: 'Gemini Free',
    description: 'Open-ended creative story generation with full AI freedom',
  },
  gemini4: {
    name: 'Guided Story',
    description: 'AI-guided story creation with structured phases',
  },
  beat: {
    name: 'Story Beats',
    description: 'Turn-by-turn story generation with structured narrative beats and arcs (uses storyTypes for configuration)',
  },
  friends: {
    name: 'Fun with my friends',
    description: 'Create an adventure story by choosing companions, picking a scenario, and watching your story come to life',
  },
};

// Available AI models
export const AI_MODELS: { value: AIModelName; label: string; description: string }[] = [
  { value: 'googleai/gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: 'Newest stable model (default)' },
  { value: 'googleai/gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Previous stable Flash' },
  { value: 'googleai/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', description: 'Most capable; preview, can change or be withdrawn' },
];

// Sentinel value for "use default" option (Radix Select doesn't allow empty string values)
export const USE_DEFAULT_VALUE = '__use_default__';
