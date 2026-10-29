import { getAIHarness, type AIHarness } from './harness';

export * from './harness';
export * from './model-registry';

/** `aiCall({ purpose, flowName, run })` on the process-wide harness. */
export const aiCall: AIHarness['call'] = (options) => getAIHarness().call(options);
/** Text generation by purpose on the process-wide harness. */
export const aiGenerateText: AIHarness['generateText'] = (options) => getAIHarness().generateText(options);
/** Image generation by purpose on the process-wide harness. */
export const aiGenerateImage: AIHarness['generateImage'] = (options) => getAIHarness().generateImage(options);
