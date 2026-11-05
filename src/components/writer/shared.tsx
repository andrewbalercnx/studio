'use client';
export type StoryPhaseForm = {
  id?: string;
  name: string;
  description: string;
  phaseType: 'warmup' | 'storyBeat' | 'ending';
  choiceCount: string;
  allowMore: boolean;
  orderIndex: string;
  status: 'draft' | 'live';
};

export type PromptConfigForm = {
  id?: string;
  phase: string;
  levelBand: string;
  status: 'draft' | 'live';
  languageCode: string;
  version: string;
  systemPrompt: string;
  modeInstructions: string;
  allowedChatMoves: string;
  modelName: string;
  modelTemperature: string;
};

export type StoryOutputForm = {
  id?: string;
  name: string;
  shortDescription: string;
  ageRange: string;
  childFacingLabel: string;
  category: 'picture_book' | 'poem' | 'coloring_pages' | 'audio_script';
  status: 'draft' | 'live' | 'archived';
  pageCount: string;
  imagePrompt: string;
  defaultPrintLayoutId: string;
  paginationPrompt: string;
  imageUrl?: string;
};
